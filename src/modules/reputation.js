/**
 * Modul reputasi: tag/kontak yang disimpan orang lain atas suatu nomor.
 *
 * Pertanyaan yang dijawab modul ini:
 *   "Apakah nomor ini dikenal orang lain sebagai sales / toko online /
 *    teman lama, atau ditandai sebagai penipuan?"
 *
 * BATAS YANG JUJUR DAN PENTING
 * =============================
 *
 * 1. TIDAK ADA sumber publik gratis untuk "nama kontak yang disimpan orang".
 *    Data itu ada di Truecaller/Whitepages, yang dibangun dari opt-in
 *    pengguna dan TIDAK disediakan lewat API terbuka. Mengambilnya
 *    berarti mengikis situs yang melarangnya (ToS) atau menyamar sebagai
 *    aplikasi — keduanya merusak reputasi alat ini dan berisiko hukum.
 *    Karena itu modul ini TIDAK pernah mengarang nama kontak.
 *
 * 2. Yang bisa dikumpulkan secara sah dan terbuka:
 *    - StopForumSpam: database spam crowdsourced (kunci opsional, IP/username)
 *    - Pola nomor: prefix yang memang dipakai kampanye spam/telemarketing
 *    - Jejak publik nomor di web (dork, sudah ada di modul breach.js)
 *
 * 3. Modul ini mengembalikan SKOR dan ALASAN, bukanvonis final.
 *    Skor spam otomatis tidak pernah jadi bukti tunggal — selalu periksa
 *    sendiri sebelum mengambil keputusan.
 */

import { requestJSON } from '../util/http.js';
import { normalize } from '../util/phone.js';
import { config } from '../config.js';

/* ── Pola nomor yang correlates dengan spam ────────────────────────────── */

/**
 * Prefiks Indonesia yangfreq sering dipakai kampanye telemarketing.
 *
 * PENTING: ini korelasi, bukan bukti. Banyak nomor sah juga memakai prefix
 * yang sama. Modul hanya menaikkan "indikasi", tidak pernah menyatakan
 * "pasti penipuan".
 */
const SPAM_PREFIX_PATTERNS = [
  // Nomor seluler yang dipakai SMS blast/telemarketingAGR sering muncul
  // bersama label ini di laporan publik.
  { re: /^021\d{8,11}$/, label: 'Nomor landline Jakarta (umum dipakai call center)', weight: 15 },
  { re: /^021\d{4}$/, label: 'Nomor landline Jakarta pendek', weight: 25 },
  { re: /^0800\d+$/, label: 'Nomor toll-free (sering dipakai claim/CS bot)', weight: 10 },
  // Nomor dengan pola berulang/berurutan sangat umum di SMS blast.
  { re: /^(\d)\1{6,}$/, label: 'Pola digit berulang — ciri SMS blast', weight: 45 },
  { re: /^(1234|4321|1234567|7654321)\d*$/, label: 'Pola angka berurutan — ciri SMS blast', weight: 45 },
];

const SPAM_KEYWORDS = [
  'spam', 'penipuan', 'scam', 'fraud', 'mantan', 'junk', 'bot', 'iklan',
  'togel', 'pinjol', 'judol', 'slot', 'pinjol', 'kredit', 'loan', 'promo',
  'undian', 'doorprize', 'cicilan', 'tagihan', 'pinjol', 'acuan', 'rentenir',
];

/**
 * Skor spam berbasis aturan (offline, tanpa jaringan).
 *
 * Angka ini hanya "indikasi", bukan vonis. Semua bobot kecil supaya satu
 * pola tidak langsung concludes "penipuan" — harus beberapa sinyal
 * sekaligus.
 */
function localSpamScore(national) {
  const digits = national.replace(/\D/g, '');
  const reasons = [];
  let score = 0;

  for (const p of SPAM_PREFIX_PATTERNS) {
    if (p.re.test(digits)) {
      score += p.weight;
      reasons.push({ signal: 'prefix', weight: p.weight, detail: p.label });
    }
  }

  // Digit beruntun panjang (mis. 1234567) di tengah nomor.
  if (/(0123|1234|2345|3456|4567|5678|6789|9876)\d{2}/.test(digits)) {
    score += 20;
    reasons.push({ signal: 'sequence', weight: 20, detail: 'Memuat urutan angka berpola.' });
  }

  // Banyak digit identik berturut-turut.
  if (/(.)\1{3,}/.test(digits)) {
    score += 25;
    reasons.push({ signal: 'repeat', weight: 25, detail: 'Memuat digit identik berulang.' });
  }

  // Nomor sangat pendek untuk seluler — sering nomor VOIP/squatting.
  if (/^0\d{9}$/.test(digits) && digits[1] !== '8') {
    score += 10;
    reasons.push({ signal: 'length', weight: 10, detail: 'Panjang nomor tidak lazim untuk seluler Indonesia.' });
  }

  // Batasi agar tidak pernah terlihat pasti.
  const bounded = Math.min(score, 85);
  return { score: bounded, reasons };
}

/**
 * Cek IP di StopForumSpam.
 *
 * SFS punya database spam crowdsourced. Endpoint yang bisa diakses tanpa key
 * hanya untuk IP dan username — endpoint nomor butuh key. Percobaan yang
 * tidak tersedia diberi status jelas supaya tidak menyesatkan.
 */
async function checkStopForumSpam(ip) {
  // Hanya IP yang bisa dicek keyless.
  if (!ip) return { checked: false, note: 'StopForumSpam hanya menerima IP pada endpoint gratis.' };

  try {
    const { status, json } = await requestJSON(
      `https://api.stopforumspam.org/api?ip=${encodeURIComponent(ip)}&json&verbose=1`,
      { retries: 1, timeout: 15000 }
    );

    if (status !== 200 || !json?.success) {
      return { checked: false, note: 'StopForumSpam tidak merespons.' };
    }

    const d = json.ip || {};
    return {
      checked: true,
      appears: !!d.appears,
      frequency: d.frequency || 0,
      confidence: d.confidence ?? null,
      asn: d.asn || null,
      country: d.country || null,
      lastseen: d.lastseen || null,
    };
  } catch (err) {
    return { checked: false, note: `StopForumSpam gagal: ${err.message}` };
  }
}

/**
 * Modul utama: reputasi & tag untuk satu nomor (dan IP opsional).
 *
 * @param {string} rawNumber - nomor telepon
 * @param {object} opts      - { ip } untuk pengecekan spam IP
 */
export async function phoneReputation(rawNumber, opts = {}) {
  const parsed = normalize(rawNumber);
  if (!parsed) {
    return { ok: false, error: `Nomor tidak valid: "${rawNumber}"` };
  }

  const { e164, national, countryCode } = parsed;

  const [local, sfs] = await Promise.all([
    Promise.resolve(localSpamScore(national)),
    checkStopForumSpam(opts.ip).catch(() => ({ checked: false })),
  ]);

  // Susun tag deskriptif dari bukti yang benar-benar ada.
  const tags = [];
  for (const r of local.reasons) {
    tags.push({ tag: r.detail, source: 'pola nomor', weight: r.weight });
  }
  if (sfs.checked && sfs.appears) {
    tags.push({
      tag: `IP terkait pernah dilaporkan spam (${sfs.frequency}x, confidence ${sfs.confidence}%)`,
      source: 'StopForumSpam',
      weight: Math.min(40, sfs.frequency),
    });
  }

  // Skor akhir: pola nomor + IP.
  let finalScore = local.score;
  if (sfs.checked && sfs.appears) finalScore += Math.min(40, sfs.frequency);

  const bounded = Math.min(finalScore, 100);
  let verdict;
  if (bounded >= 60) verdict = 'high_risk';
  else if (bounded >= 30) verdict = 'some_risk';
  else verdict = 'low_risk';

  const labelMap = {
    high_risk: 'Indikasi kuat nomor dipakai spam/penipuan',
    some_risk: 'Perlu kehati-hatian — ada satu/beberapa sinyal',
    low_risk: 'Tidak ada sinyal negatif pada data publik',
  };

  return {
    ok: true,
    number: e164,
    national,
    countryCode,
    score: bounded,
    verdict,
    verdictLabel: labelMap[verdict],
    tags,
    signals: {
      patternScore: local.score,
      ipSpam: sfs.checked ? { appears: sfs.appears, frequency: sfs.frequency, confidence: sfs.confidence } : null,
    },
    stopForumSpam: sfs,
    note:
      'Skor ini disusun dari POLA NOMOR dan laporan spam crowdsourced yang terbuka — bukan dari ' +
      'kontak tersimpan pengguna. Tidak ada sumber publik gratis untuk nama kontak yang disimpan ' +
      'orang lain, jadi modul ini tidak mengarangnya. Perlakukan sebagai indikator, bukan vonis.',
    limitation:
      config.hibpKey
        ? null
        : 'Untuk daftar nomor yang benar-benar dipastikan spam, cek juga HIBP (butuh key).',
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cek reputasi username di StopForumSpam (crowdsourced, keyless).
 * Berguna untuk username yang dipakai di forum atau spam.
 */
export async function usernameReputation(username) {
  const u = String(username || '').trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(u)) {
    return { ok: false, error: 'Username tidak valid (a-z, 0-9, ., _, -, maks 64).' };
  }

  try {
    const { status, json } = await requestJSON(
      `https://api.stopforumspam.org/api?username=${encodeURIComponent(u)}&json&verbose=1`,
      { retries: 1, timeout: 15000 }
    );

    if (status !== 200 || !json?.success) {
      return { ok: false, username: u, error: 'StopForumSpam tidak merespons.' };
    }

    const d = json.username || {};
    const tags = [];
    if (d.appears) {
      tags.push({ tag: `Pernah dilaporkan spam (${d.frequency}x)`, source: 'StopForumSpam' });
    }
    // Kata kunci yang sering menyatu di laporan.
    const lower = u.toLowerCase();
    const kws = SPAM_KEYWORDS.filter((k) => lower.includes(k));
    if (kws.length) tags.push({ tag: `Mengandung kata kunci mencurigakan: ${kws.join(', ')}`, source: 'heuristik' });

    return {
      ok: true,
      username: u,
      appears: !!d.appears,
      frequency: d.frequency || 0,
      confidence: d.confidence ?? null,
      lastseen: d.lastseen || null,
      tags,
      verdict: d.appears ? 'reported_spam' : 'not_reported',
      note: 'StopForumSpam melaporkan nomor/username yang dilaporkan spam oleh komunitas (crowdsourced).',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, username: u, error: err.message };
  }
}

/**
 * Dorking crowdsourced: cari jejak nomor di sumber spam publik.
 * Menghasilkan query siap pakai, tidak mengirim nomor ke API pihak ketiga
 * selain mesin pencari.
 */
export function reputationDorks(number) {
  const parsed = normalize(number);
  if (!parsed) return { ok: false, error: 'Nomor tidak valid.' };
  const digits = parsed.digits;

  const queries = [
    {
      label: 'Laporan spam',
      query: `"${digits}" (spam OR penipuan OR scam OR "kategori spam")`,
      why: 'Mencari nomor yang sudah dilaporkan sebagai spam oleh pengguna lain.',
    },
    {
      label: 'Kontak sales / toko online',
      query: `"${digits}" (whatsapp OR "wa.me" OR shopee OR tokopedia OR lazada OR "jual beli")`,
      why: 'Melihat apakah nomor dipakai untuk jualan online atau kontak penjualan.',
    },
    {
      label: 'Review &-complain',
      query: `"${digits}" (review OR keluhan ORaland OR komplain OR "tidak terima")`,
      why: 'Mencari keluhan pengguna — pola yang khas untuk indikasi penipuan.',
    },
    {
      label: 'Blacklist',
      query: `"${digits}" (blacklist OR blocklist OR "dilarang" OR "layak" OR "penipuan")`,
      why: 'Mencari nomor yang masuk daftar hitam di situs atau forum.',
    },
  ];

  return {
    ok: true,
    number: parsed.e164,
    dorks: queries.map((q) => ({
      ...q,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(q.query)}`,
      bingUrl: `https://www.bing.com/search?q=${encodeURIComponent(q.query)}`,
      ddgUrl: `https://duckduckgo.com/?q=${encodeURIComponent(q.query)}`,
    })),
    note:
      'Query di atas dirancang untuk DIGOLAKAN SECARA MANUAL di browser — nomor tidak dikirim ' +
      'ke API mana pun oleh modul ini.',
    generatedAt: new Date().toISOString(),
  };
}

export const reputationTools = [
  { id: 'phone-reputation', label: 'Reputasi & Tag Nomor', needs: 'phone' },
  { id: 'username-reputation', label: 'Reputasi Username', needs: 'username' },
  { id: 'reputation-dorks', label: 'Dork Reputasi', needs: 'phone' },
];