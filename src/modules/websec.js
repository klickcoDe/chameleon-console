/**
 * Modul keamanan website: penilaian PASIF atasposting konfigurasi yang
 * kelihatan dari luar.
 *
 * Yang dilakukan modul ini:
 *   - Membaca sertifikat TLS (chain, masa berlaku, SAN, issuer)
 *   - Menilai header keamanan yang sudah ada di domain.js
 *   - Memeriksa keberadaan security.txt (RFC 9116) & robots.txt
 *   - Mengecek sejumlah path sensitif yang TERBUKA (GET tunggal per path)
 *
 * Yang SENGAJA tidak dilakukan — ini batas etis modul:
 *   - TIDAK port scan (port scan ada di modul terpisah src/modules/portscan.js,
 *     dan hanya berjalan atas target yang Anda tentukan sendiri)
 *   - TIDAK brute force / login attempt
 *   - TIDAK eksploitasi, injection, atau bypass
 *   - TIDAK mengambil muatan dari path yang ditemukan terbuka (hanya status)
 *
 * Setiap pemeriksaan adalah SATU request GET/HEAD yang sama dengan yang
 * dilakukan browser biasa. Modul ini berguna untuk menilai posture keamanan
 * milik Anda sendiri atau sistem yang Anda berwenang mengujinya.
 *
 * Modul ini hanya membaca; tidak menulis, tidak mengubah, tidak mengeksploitasi.
 */

import tls from 'node:tls';
import crypto from 'node:crypto';
import { request } from '../util/http.js';

/* ── Pemeriksaan TLS ──────────────────────────────────────────────────── */

/**
 * Ambil dan analisis sertifikat TLS suatu host.
 * Pakai modul bawaan node:tls — nol dependensi.
 */
export function inspectTLS(hostRaw, port = 443, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let host = String(hostRaw || '').trim();
    if (!host) return resolve({ ok: false, error: 'Host kosong.' });

    // Buang skema/path kalau user menempel URL lengkap.
    host = host.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].split(':')[0];

    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; try { socket.end(); } catch {} resolve(v); } };

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const authError = socket.authorizationError || null;

        const now = Date.now();
        const notBefore = cert.valid_from ? Date.parse(cert.valid_from) : null;
        const notAfter = cert.valid_to ? Date.parse(cert.valid_to) : null;

        const findings = [];
        if (!authorized) {
          findings.push({
            severity: 'high',
            title: 'Sertifikat tidak tepercaya',
            detail: authError || 'Verifikasi sertifikat gagal.',
          });
        }
        if (notAfter && now > notAfter) {
          findings.push({
            severity: 'critical',
            title: 'Sertifikat kedaluwarsa',
            detail: `Kedaluwarsa sejak ${cert.valid_to}.`,
          });
        } else if (notAfter) {
          const daysLeft = Math.floor((notAfter - now) / 86400000);
          if (daysLeft < 15) {
            findings.push({
              severity: daysLeft < 7 ? 'high' : 'medium',
              title: 'Sertifikat hampir kedaluwarsa',
              detail: `Kurang ${daysLeft} hari lagi (${cert.valid_to}).`,
            });
          }
        }
        if (notBefore && now < notBefore) {
          findings.push({
            severity: 'high',
            title: 'Sertifikat belum berlaku',
            detail: `Mulai berlaku ${cert.valid_from}.`,
          });
        }

        // Self-signed tanpa CA = umumnya tidak untuk produksi publik.
        const issuerName = cert.issuer?.O || cert.issuer?.CN || null;
        const subjectName = cert.subject?.CN || cert.subject?.O || null;
        if (issuerName && subjectName && issuerName === subjectName && !authorized) {
          findings.push({
            severity: 'high',
            title: 'Kemungkinan self-signed',
            detail: `Issuer sama dengan subject (${subjectName}).`,
          });
        }

        finish({
          ok: true,
          host,
          port,
          authorized,
          authorizationError: authError,
          subject: cert.subject || null,
          issuer: cert.issuer || null,
          subjectAltNames: (cert.subjectaltname || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 50),
          validFrom: cert.valid_from || null,
          validTo: cert.valid_to || null,
          daysRemaining: notAfter ? Math.floor((notAfter - now) / 86400000) : null,
          serialNumber: cert.serialNumber || null,
          fingerprint256: cert.fingerprint256 || null,
          protocol: socket.getProtocol?.() || null,
          secure: !!(socket.authorized),
          findings,
          note:
            'Analisis performed pada satu koneksi TLS. Tidak ada exploit, hanya membaca ' +
            'sertifikat yang memang dikirim server secara terbuka.',
        });
      }
    );

    socket.setTimeout(timeoutMs, () => {
      finish({ ok: false, host, error: `Koneksi TLS timeout ${timeoutMs}ms.` });
    });
    socket.on('error', (err) => {
      finish({
        ok: false,
        host,
        error: `Gagal handshake TLS: ${err.message}`,
        hint:
          /ECONNREFUSED|EPROTO|wrong version/i.test(err.message)
            ? 'Kemungkinan host tidak menyediakan HTTPS pada port ini.'
            : undefined,
      });
    });
  });
}

/* ── Path sensitif yang terbuka ───────────────────────────────────────── */

/**
 * Daftar path yang umum tidak seharusnya bisa diakses publik.
 *
 * Modul hanya melakukan SATU GET per path dan hanya memeriksa status code —
 * TIDAK mengunduh atau menampilkan isi file. Yang dibutuhkan investigator
 * cuma tahu "ada/tidak", bukan isi.
 */
const SENSITIVE_PATHS = [
  { path: '/.git/config', label: 'Git config', why: 'Membocorkan struktur repo & remote', severity: 'critical' },
  { path: '/.git/HEAD', label: 'Git HEAD', why: 'Konfirmasi direktori .git terekspos', severity: 'critical' },
  { path: '/.env', label: 'File .env', why: 'Sering memuat kunci API & kredensial', severity: 'critical' },
  { path: '/.svn/entries', label: 'SVN entries', why: 'Metodologi lama, repo terekspos', severity: 'high' },
  { path: '/backup.zip', label: 'Backup zip', why: 'Arsip cadangan yang tidak sengaja publik', severity: 'medium' },
  { path: '/wp-config.php.bak', label: 'WP config backup', why: 'Konfigurasi WordPress bocor', severity: 'critical' },
  { path: '/phpinfo.php', label: 'phpinfo', why: 'Membocorkan versi PHP & environment', severity: 'high' },
  { path: '/server-status', label: 'Apache server-status', why: 'Status Apache publik', severity: 'medium' },
  { path: '/.DS_Store', label: '.DS_Store', why: 'Metadata folder macOS', severity: 'low' },
  { path: '/debug', label: 'Debug endpoint', why: 'Jejak debug bisa aktif', severity: 'medium' },
  { path: '/actuator/health', label: 'Spring actuator', why: 'Health endpoint Spring Boot', severity: 'medium' },
  { path: '/api/docs', label: 'API docs', why: 'Dokumentasi API publik (informasi, bukan celah)', severity: 'info' },
];

/**
 * Periksa path-path di atas terhadap satu host.
 *
 * Setiap pemeriksaan: satu GET, hanya kode status. Tidak ada payload,
 * tidak ada eksploitasi. Ini identik dengan yang dilakukan browser.
 *
 * DETEKSI SOFT-404
 * ----------------
 * Banyak situs besar memakai routing catch-all: SEMUA path yang tidak
 * dikenal dibalas 200 dengan halaman yang sama (mis. halaman 404 mereka
 * sendiri). Kalau hanya status !== 404 yang dianggap bocor, hasilnya
 * penuh false positive.
 *
 * Bukti nyata: GitHub membalas HTTP 200 untuk /server-status maupun
 * /debug, padahal keduanya bukan file Apache — isinya sama persis
 * dengan halaman beranda. Versi pertama modul ini salah melaporkan
 * keduanya sebagai "TERBUKA".
 *
 * Karena itu setiap path dibandingkan terhadap satu path acak yang pasti
 * tidak ada (baseline). Kalau isi keduanya identik, itu soft-404.
 */
export async function checkExposedPaths(baseUrlRaw, { timeout = 8000 } = {}) {
  let base = String(baseUrlRaw || '').trim();
  if (!base) return { ok: false, error: 'URL kosong.' };
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');

  // Path acak: hampir pasti tidak ada di situs mana pun.
  const BASELINE_PATH =
    `/${Math.random().toString(36).slice(2)}${Date.now().toString(36)}-osintprobe404`;

  // Ambil baseline lebih dulu: status + sidik jari isi.
  let baseline = { status: 0, signature: null, ok: false };
  try {
    const res = await request(base + BASELINE_PATH, {
      method: 'GET', browserUA: true, timeout, retries: 0,
    });
    baseline = {
      status: res.status,
      signature: fingerprintBody(res.text || ''),
      ok: true,
    };
  } catch (err) {
    baseline = { status: 0, signature: null, ok: false, error: err.message };
  }

  const results = [];
  const CONCURRENCY = 5; // jangan membebani target

  let cursor = 0;
  async function worker() {
    while (cursor < SENSITIVE_PATHS.length) {
      const p = SENSITIVE_PATHS[cursor++];
      const entry = { ...p, url: base + p.path, status: null, verdict: 'error', detail: null };

      try {
        const res = await request(entry.url, {
          method: 'GET', browserUA: true, timeout, retries: 0,
        });
        entry.status = res.status;

        if (res.status === 200) {
          const sig = fingerprintBody(res.text || '');
          const sameAsBaseline =
            baseline.ok && baseline.signature &&
            sig === baseline.signature && baseline.status === res.status;

          if (sameAsBaseline) {
            entry.verdict = 'soft_404';
            entry.detail =
              'Status 200 tapi isinya identik dengan path acak yang tidak ada — ini routing ' +
              'catch-all, bukan file terekspos.';
          } else if (looksLikeErrorPage(res.text || '')) {
            entry.verdict = 'soft_404';
            entry.detail = 'Status 200 tapi isinya halaman error — soft-404.';
          } else {
            entry.verdict = 'exposed';
            entry.detail = 'Path TERBUKA (status 200) dan isinya berbeda dari halaman tidak-ditemukan.';
          }
        } else if (res.status === 401 || res.status === 403) {
          entry.verdict = 'protected';
          entry.detail = 'Dilindungi autentikasi.';
        } else if (res.status === 404 || res.status === 410) {
          entry.verdict = 'not_found';
          entry.detail = 'Tidak ada.';
        } else if ([301, 302, 307, 308].includes(res.status)) {
          entry.verdict = 'redirect';
          entry.detail = 'Dialihkan — perlu cek manual.';
        } else {
          entry.verdict = 'other';
          entry.detail = `Status ${res.status}.`;
        }
      } catch (err) {
        entry.verdict = 'unreachable';
        entry.detail = err.message;
      }

      results.push(entry);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, SENSITIVE_PATHS.length) }, worker)
  );

  const exposed = results.filter((r) => r.verdict === 'exposed');

  return {
    ok: true,
    baseUrl: base,
    checked: results.length,
    exposedCount: exposed.length,
    exposed,
    results,
    baseline: {
      path: BASELINE_PATH,
      status: baseline.status,
      available: baseline.ok,
      note: baseline.ok
        ? 'Path acak ini dipakai sebagai pembanding. Path yang isinya sama dianggap soft-404, bukan bocor.'
        : `Baseline gagal diambil (${baseline.error || 'tidak diketahui'}) — deteksi soft-404 dilewati, hasil bisa mengandung false positive.`,
    },
    summary: {
      exposed: exposed.length,
      protected: results.filter((r) => r.verdict === 'protected').length,
      notFound: results.filter((r) => r.verdict === 'not_found').length,
      soft404: results.filter((r) => r.verdict === 'soft_404').length,
      other: results.filter((r) => ['redirect', 'other', 'unreachable', 'error'].includes(r.verdict)).length,
    },
    note:
      'Setiap pemeriksaan adalah SATU request GET identik dengan browser biasa. Hanya kode ' +
      'status yang dibaca — isi file tidak diambil maupun ditampilkan. Tidak ada eksploitasi.',
    caveat:
      'PENTING: pada situs dengan routing catch-all, setiap path bisa jadi "halaman valid". ' +
      'Contoh nyata yang terverifikasi: di github.com, /debug dan /server-status membalas 200 ' +
      'karena keduanya ditafsirkan sebagai PROFIL PENGGUNA (github.com/debug adalah akun "Dom"), ' +
      'bukan file terekspos. Verifikasi manual sebelum menyimpulkan apa pun — dan jangan arahkan ' +
      'pemeriksaan ini ke situs orang lain tanpa izin.',
  };
}

/** Apakah teks ini tampak seperti halaman error? */
function looksLikeErrorPage(text = '') {
  return /(page not found|not found|404|forbidden|access denied|does ?n[o']?t exist|tidak ditemukan)/i
    .test(text.slice(0, 2000));
}

/**
 * Sidik jari isi halaman supaya dua respons bisa dibandingkan tanpa
 * menyimpan seluruh body.
 *
 * Bagian dinamis (hash, token, angka panjang) dibuang supaya halaman
 * soft-404 yang sama tetap bisa dikenali.
 */
function fingerprintBody(text = '') {
  return crypto
    .createHash('sha256')
    .update(
      text
        .replace(/[0-9a-f]{32,64}/gi, '')
        .replace(/\b\d{4,}\b/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000)
    )
    .digest('hex')
    .slice(0, 32);
}

/* ── security.txt & robots.txt (RFC 9116) ────────────────────────────── */

/**
 * Ambil security.txt (kontak pelapor kerentanan) dan ringkas robots.txt.
 * Ini praktik KEHATIAN, bukan kerentanan — tapi keberadaannya menunjukkan
 * apakah organisasi punya jalur pelaporan yang jelas.
 */
export async function checkSecurityTxt(baseUrlRaw) {
  let base = String(baseUrlRaw || '').trim();
  if (!base) return { ok: false, error: 'URL kosong.' };
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');

  const out = { securityTxt: null, robotsTxt: null };

  /* security.txt */
  try {
    const res = await request(`${base}/.well-known/security.txt`, {
      browserUA: true, timeout: 10000, retries: 1,
    });
    if (res.status === 200) {
      const text = res.text || '';
      const field = (k) => (text.match(new RegExp(`^${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || null;
      out.securityTxt = {
        found: true,
        contact: field('Contact'),
        expires: field('Expires'),
        policy: field('Policy'),
        preferredLanguages: field('Preferred-Languages'),
        canonical: field('Canonical'),
        hasExpired: /Expires:\s*(\S+)/i.test(text)
          ? Date.parse(field('Expires')) < Date.now()
          : null,
        note: 'Keberadaan security.txt = organisasi punya jalur pelaporan resmi (praktik baik).',
      };
    } else {
      out.securityTxt = {
        found: false,
        status: res.status,
        note: 'Tidak ada /.well-known/security.txt — tidak ada kontak pelapor resmi yang dipublikasikan.',
      };
    }
  } catch (err) {
    out.securityTxt = { found: false, error: err.message };
  }

  /* robots.txt — ringkas, jangan dump mentah (bisa panjang). */
  try {
    const res = await request(`${base}/robots.txt`, { browserUA: true, timeout: 10000, retries: 1 });
    if (res.status === 200) {
      const lines = (res.text || '').split('\n');
      const disallows = lines.filter((l) => /^\s*disallow\s*:/i.test(l)).slice(0, 15)
        .map((l) => l.replace(/^\s*disallow\s*:\s*/i, '')).filter(Boolean);
      out.robotsTxt = {
        found: true,
        lineCount: lines.length,
        hasSitemap: /sitemap\s*:/i.test(res.text || ''),
        disallowSamples: disallows,
        note:
          'Disallow di robots.txt bukan mekanisme keamanan — hanya alat crawling. Path yang ' +
          'di-Disallow tetap bisa diakses publik. Jangan dipakai sebagai bukti "terlindungi".',
      };
    } else {
      out.robotsTxt = { found: false, status: res.status };
    }
  } catch (err) {
    out.robotsTxt = { found: false, error: err.message };
  }

  return { ok: true, baseUrl: base, ...out };
}

/* ── Ringkasan posture (memakai modul domain untuk header) ───────────── */

/**
 * Ambil analisis header keamanan dari modul domain lalu tambahkan
 * temuan TLS di dalamnya, supaya investigator dapat satu gambaran.
 */
export async function fullWebPosture(urlRaw) {
  const [tlsResult, securityTxt] = await Promise.all([
    inspectTLS(urlRaw),
    checkSecurityTxt(urlRaw).catch(() => ({ ok: false })),
  ]);

  const parsed = String(urlRaw || '').replace(/^https?:\/\//i, '');
  const host = parsed.split(/[/?#]/)[0].split(':')[0];

  const parts = [];
  if (tlsResult.ok) {
    parts.push({ area: 'TLS/Sertifikat', score: tlsResult.findings.length === 0 ? 100 : Math.max(0, 100 - tlsResult.findings.length * 25) });
  } else {
    parts.push({ area: 'TLS/Sertifikat', score: 0, error: tlsResult.error });
  }
  parts.push({ area: 'Keamanan Pelaporan', score: securityTxt?.securityTxt?.found ? 100 : 40 });

  const average = Math.round(parts.reduce((n, p) => n + (p.score || 0), 0) / parts.length);

  return {
    ok: true,
    host,
    tls: tlsResult,
    securityTxt: securityTxt?.securityTxt || null,
    robotsTxt: securityTxt?.robotsTxt || null,
    sections: parts,
    overallScore: average,
    note:
      'Modul ini menilai KONFIGURASI yang terlihat dari luar (sertifikat, header, file ' +
      'sensitif yang terbuka). Ini bukan penetration test dan tidak mengeksploitasi apa pun.',
  };
}

export const websecTools = [
  { id: 'tls-inspect', label: 'Analisis Sertifikat TLS', needs: 'url' },
  { id: 'web-paths', label: 'Path Sensitif Terbuka', needs: 'url' },
  { id: 'security-txt', label: 'security.txt & robots.txt', needs: 'url' },
  { id: 'web-posture', label: 'Posture Web Lengkap', needs: 'url' },
];