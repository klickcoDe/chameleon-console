/**
 * Utilitas forensik: hash, dekoder, dan analisis kata sandi.
 *
 * Modul ini bekerja SEPENUHNYA secara lokal di server — tidak ada satu pun
 * data yang dikirim ke pihak ketiga. Ini penting: hash kata sandi tidak boleh
 * bocor ke log atau API pihak ketiga.
 *
 * Catatan MD5: MD5 dan SHA-1 tidak lagi aman untuk keamanan (tabrakan hash
 * bisa dibuat), tapi KEDUANYA masih dipakai luas untuk hal yang lain —
 * verifikasi file, identifier, dan kunci API lawas. Jadi keduanya disediakan
 * sebagai alat identifikasi, bukan sebagai rekomendasicrypto.
 */

import crypto from 'node:crypto';

/* ── Hash ──────────────────────────────────────────────────────────────── */

/** Hitung hash dengan satu algoritma. */
export function hashWith(algorithm, input, { uppercase = true } = {}) {
  const hash = crypto.createHash(algorithm).update(input, 'utf8').digest('hex');
  return uppercase ? hash.toUpperCase() : hash;
}

/** Hitung semua algoritma sekaligus — praktis untuk membandingkan satu input. */
export function hashAll(input) {
  return {
    md5: hashWith('md5', input),
    sha1: hashWith('sha1', input),
    sha256: hashWith('sha256', input),
    sha512: hashWith('sha512', input).slice(0, 128),
    // Panjang penuh SHA-512 (128 hex) dipotong di atas hanya untuk tampilan;
    // nilai sebenarnya tetap tersedia lewat /api/hash dengan format=full.
  };
}

/**
 * Panjang hash dalam bit untuk tiap algoritma, untuk identifikasi otomatis.
 */
const HASH_LENGTHS = {
  32: ['MD5', 'MD4', 'NTLM', 'LM hash'],
  40: ['SHA-1', 'RIPEMD-160', 'Haval-128/3', 'Tiger-160', 'HAS-160'],
  56: ['SHA-224', 'Haval-224', 'Tiger-192'],
  64: [
    'SHA-256', 'SHA-3-256', 'RIPEMD-256', 'BLAKE2s-256',
    'Keccak-256', 'SM3', 'GOST R 34.11-256',
  ],
  96: ['MD5+SHA-1 concatenated', 'SHA-384 (truncated)'],
  128: ['SHA-512', 'SHA-3-512', 'Whirlpool', 'BLAKE2b-512', 'Keccak-512'],
};

/**
 * Deteksi jenis hash dari panjang + pola karakternya.
 *
 * Panjang hanya memberi KEMUNGKINAN, bukan kepastian — dua algoritma bisa
 * saja punya panjang sama (SHA-256 dan SHA3-256 sama-sama 64 hex). Jadi
 * hasilnya selalu disajikan sebagai "kemungkinan", bukan ">username< pasti".
 */
export function identifyHash(input) {
  const value = String(input || '').trim().toLowerCase();

  if (!value) {
    return { ok: false, error: 'Hash kosong.' };
  }

  // 1. Format dengan pola khas yang TIDAK mungkin tertukar dengan hex.
  //
  // Catatan urutan: pola base64 SENGAJA diperiksa setelah heksadesimal.
  // Kalau tidak, setiap hash hex yang panjangnya kelipatan 4 akan cocok
  // pola base64 (karena a-f dan 0-9 semuanya karakter base64 yang sah)
  // dan dilaporkan sebagai "Base64" — padahal itu hash. Hash lebih sering
  // daripada base64, jadi winsor yang lebih spesifik harus menang.
  const patterns = [
    {
      type: 'JWT',
      re: /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/,
      note: 'JSON Web Token. Bagian tengahnya adalah payload base64url yang bisa langsung dibaca.',
    },
    {
      type: 'Bitcoin Address (P2PKH)',
      re: /^1[1-9a-hj-np-z]{25,34}$/,
      note: 'Alamat Bitcoin legacy (bukan hash, tapi sering muncul di dump kebocoran).',
    },
    {
      type: 'Ethereum Address',
      re: /^0x[0-9a-f]{40}$/,
      note: 'Alamat dompet Ethereum (20 byte), bukan hash.',
    },
  ];

  for (const p of patterns) {
    if (p.re.test(value) && (!p.minLength || value.length >= p.minLength)) {
      return { ok: true, detected: p.type, confidence: 'medium', note: p.note };
    }
  }

  // 2. Hash heksadesimal — identifikasi lewat panjang.
  //
  // Dicek sebelum base64, dan hanya bila panjangnya cocok dengan salah satu
  // algoritma hash yang umum. String hex dengan panjang ganjil (mis. 33 atau
  // 41) jelas bukan hash, dan tidak akan tertangkap regex di bawah.
  if (/^[0-9a-f]+$/.test(value)) {
    const candidates = HASH_LENGTHS[value.length];
    return {
      ok: true,
      detected: candidates ? 'Hash heksadesimal' : 'String heksadesimal',
      hexLength: value.length,
      bitLength: value.length * 4,
      candidates: candidates || [],
      confidence: candidates && candidates.length === 1 ? 'high' : candidates ? 'medium' : 'low',
      note: candidates?.length
        ? `Panjang ${value.length} hex cocok dengan: ${candidates.join(', ')}. Panjang saja belum membuktikan algoritma — dua algoritma bisa sama panjangnya.`
        : `Panjang ${value.length} hex tidak cocok dengan algoritma hash umum yang diketahui.`,
    };
  }

  // 3. Base64 — setelah heksadesimal, lihat catatan urutan di atas.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 16) {
    return {
      ok: true,
      detected: 'Base64',
      confidence: 'medium',
      note: 'Kemungkinan string base64. Coba decode lewat /api/decode.',
    };
  }

  return {
    ok: false,
    error: 'Format tidak dikenali sebagai hash hex, JWT, atau alamat kripto.',
    hint: 'Hash heksadesimal hanya berisi karakter 0-9 dan a-f.',
  };
}

/* ── Dekoder ───────────────────────────────────────────────────────────── */

/**
 * Dekode string base64 (standar maupun URL-safe).
 *
 * Fungsi ini murni offline: tidak ada permintaan jaringan. Hasilnya bisa
 * berupa teks atau binary; kalau binary, ditampilkan sebagai heksadesimal
 * supaya tetap bisa dilihat.
 */
export function decodeBase64(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Input kosong.' };

  // URL-safe base64 pakai - dan _, harus diubah ke bentuk standar.
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  // Tambahkan padding yang hilang.
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    const buffer = Buffer.from(padded, 'base64');

    // Deteksi apakah hasil decode adalah teks yang bisa dibaca.
    const asText = buffer.toString('utf8');
    const printableRatio = [...asText].filter((c) => c === '\n' || c === '\t' || (c >= ' ' && c <= '�')).length;
    const isText = buffer.length > 0 && printableRatio / asText.length > 0.85;

    return {
      ok: true,
      encoding: 'base64',
      decoded: isText ? asText : null,
      binary: !isText,
      hex: buffer.toString('hex'),
      byteLength: buffer.length,
      note: isText
        ? 'Hasil decode ditampilkan sebagai teks.'
        : 'Hasil decode bukan teks yang bisa dibaca — ditampilkan sebagai heksadesimal.',
    };
  } catch (err) {
    return { ok: false, error: `Gagal decode base64: ${err.message}` };
  }
}

/**
 * Dekode JWT tanpa memverifikasi signature.
 *
 * PENTING: JWT yang didekode di sini BELUM terverifikasi. Signature hanya
 * bisa dicek dengan kunci yang dipakai penerbit token. Membaca payload JWT
 * hanya memberi klaim yang dicantumkan penerbit token, bukan
 * bukti kebenaran. Untuk produksi, gunakan jwt.io atau pustaka resmi.
 */
export function decodeJWT(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');

  if (parts.length !== 3) {
    return {
      ok: false,
      error: `JWT harus punya 3 bagian dipisah titik, ditemukan ${parts.length}.`,
    };
  }

  const decodePart = (part) => {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  };

  try {
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);

    // Tanggal expiry dikembalikan sebagai teks + timestamp UNIX asli,
    // supaya investigator bisa membacanya tanpa menghitung sendiri.
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    const iat = typeof payload.iat === 'number' ? payload.iat : null;
    const toIso = (n) => (n ? new Date(n * 1000).toISOString() : null);
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      ok: true,
      header,
      payload,
      signature: parts[2] || null,
      timestamps: {
        issuedAt: iat,
        issuedAtIso: toIso(iat),
        expiresAt: exp,
        expiresAtIso: toIso(exp),
        expired: exp ? nowSec > exp : null,
        notYetValid: iat ? nowSec < iat : null,
      },
      note:
        'Signature TIDAK diverifikasi oleh alat ini. Isi payload adalah klaim yang dicantumkan penerbit token, bukan fakta terverifikasi. Jangan pakai ini sebagai bukti autentikasi.',
    };
  } catch (err) {
    return { ok: false, error: `Gagal parse JWT: ${err.message}` };
  }
}

/**
 * Dekode berdasarkan format — mencoba semua yang cocok.
 * Dipakai endpoint /api/decode supaya pengguna tidak perlu tahu formatnya.
 */
export function decodeAuto(input) {
  const raw = String(input || '').trim();
  const attempts = [];

  if (raw.split('.').length === 3 && raw.startsWith('ey')) {
    const jwt = decodeJWT(raw);
    attempts.push({ format: 'JWT', ...jwt });
    if (jwt.ok) return { ok: true, format: 'JWT', ...jwt };
  }

  const b64 = decodeBase64(raw);
  if (b64.ok) {
    attempts.push({ format: 'base64', ...b64 });
    return { ok: true, format: 'base64', ...b64, attempts };
  }

  // URL decoding.
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) {
      attempts.push({ format: 'url', decoded });
      return { ok: true, format: 'url', decoded, attempts };
    }
  } catch { /* bukan URL encoding */ }

  // Hex.
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) {
    const buf = Buffer.from(raw, 'hex');
    const asText = buf.toString('utf8');
    const printable = [...asText].every((c) => c === '\n' || c === '\t' || (c >= ' ' && c <= '�'));
    const hex = { format: 'hex', decoded: printable ? asText : null, hex: buf.toString('hex'), binary: !printable };
    attempts.push(hex);
    return { ok: true, ...hex, attempts };
  }

  return {
    ok: false,
    error: 'Tidak ada format yang cocok (JWT / base64 / URL / hex).',
    attempts,
  };
}

/* ── Analisis kata sandi ───────────────────────────────────────────────── */

/**
 * Hitung entropi (bit) dari sebuah string.
 * Bobot setiap karakter memakai frekuensi kemunculannya.
 */
export function shannonEntropy(str) {
  if (!str.length) return 0;
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Daftar kata sandi yang sangat umum — hanya untuk perksiraan, bukan daftar lengkap. */
const COMMON_PASSWORDS = new Set([
  'password', 'passw0rd', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'abc123', 'password1', 'iloveyou', 'admin', 'welcome',
  'monkey', 'dragon', 'letmein', 'sunshine', 'princess', 'football',
  'charlie', 'shadow', 'master', 'qwerty123', 'login', 'passw0rd',
  'budi', 'indonesia', 'jakarta', 'bandung',
]);

/**
 * Analisis kekuatan kata sandi secara lokal.
 * Tidak pernah mengirim kata sandi ke mana pun — semuanya dihitung di server.
 */
export function analysePassword(password) {
  const pw = String(password || '');
  if (!pw) return { ok: false, error: 'Kata sandi kosong.' };

  const entropy = shannonEntropy(pw);
  const lower = pw.toLowerCase();

  const checks = {
    length: pw.length >= 12,
    longEnough: pw.length >= 16,
    hasLower: /[a-z]/.test(pw),
    hasUpper: /[A-Z]/.test(pw),
    hasDigit: /\d/.test(pw),
    hasSymbol: /[^A-Za-z0-9]/.test(pw),
    notCommon: !COMMON_PASSWORDS.has(lower),
    noSequential: !/(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwerty)/i.test(pw),
    noRepeat: !/(.)\1{3,}/.test(pw),
  };

  // Peringatan yang lebih berat daripada sekadar "huruf besar kurang".
  const issues = [];
  if (!checks.longEnough) issues.push('Panjang di bawah 16 karakter — ini penyebab utama password lemah.');
  if (!checks.notCommon) issues.push('Kata sandi ini ada di daftar password paling umum di dunia.');
  if (!checks.noSequential) issues.push('Memuat urutan karakter berpola (mis. 1234 atau abcd).');
  if (!checks.noRepeat) issues.push('Memuat karakter yang berulang 4 kali atau lebih.');
  if (!checks.hasSymbol) issues.push('Tidak memuat simbol.');
  if (!checks.hasUpper || !checks.hasLower) issues.push('Hanya satu jenis huruf — campur huruf besar dan kecil.');
  if (!checks.hasDigit) issues.push('Tidak memuat angka.');

  // Skor kasar 0-4, hanya sebagai alat bantu menilai, bukan standar resmi.
  let score = 0;
  if (checks.length) score++;
  if (checks.hasLower && checks.hasUpper) score++;
  if (checks.hasDigit && checks.hasSymbol) score++;
  if (checks.notCommon && checks.noSequential && checks.noRepeat && checks.longEnough) score++;

  const labels = ['Sangat lemah', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'];

  return {
    ok: true,
    length: pw.length,
    entropyBits: Number(entropy.toFixed(2)),
    // Perkiraan kekuatanOffline: panjang xbits per karakter unik.
    estimatedStrengthBits: Number((entropy * Math.log2(pw.length || 1)).toFixed(2)),
    score,
    label: labels[score],
    checks,
    issues,
    note:
      'Analisis dihitung sepenuhnya di server — kata sandi tidak dikirim ke pihak mana pun. ' +
      'Angka ini perkiraan kasar, bukan hasil pengujian penetration.',
  };
}

export const cryptoTools = [
  { id: 'hash', label: 'Hash Input', needs: 'text' },
  { id: 'identify', label: 'Identifikasi Hash', needs: 'hash' },
  { id: 'decode', label: 'Dekoder', needs: 'encoded' },
  { id: 'password', label: 'Analisis Password', needs: 'password' },
];