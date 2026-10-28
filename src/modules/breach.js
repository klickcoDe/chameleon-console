/**
 * Modul kebocoran data (data breach) + generator dork.
 *
 * Have I Been Pwned (HIBP) WAJIB API key. Tanpa key, modul ini mengembalikan
 * status "unconfigured" — TIDAK pernah mengarang hasil. Itu penting: hasil
 * palsu diinvestigasi akan merusak kredibilitas seluruh laporan.
 *
 * Untuk data breach gratis tanpa key, arahkan pengguna ke Firefox Monitor
 * (monitor.mozilla.org) yang punya UI sendiri, lalu catat hasilnya manual.
 */

import { config } from '../config.js';
import { request, requestJSON, stripTags } from '../util/http.js';

const isEmail = (v = '') => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());

/**
 * Cek email terhadap HIBP.
 * Endpoint: GET https://haveibeenpwned.com/api/v3/breachedaccount/{email}?truncateResponse=true
 * Header wajib: hibp-api-key
 */
export async function checkBreach(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!isEmail(email)) {
    return { ok: false, error: `Email tidak valid: "${rawEmail}"` };
  }

  if (!config.hibpKey) {
    return {
      ok: false,
      unconfigured: true,
      email,
      error:
        'HAVEI_BEEN_PWNED_API_KEY belum di-set. Ambil key gratis di ' +
        'https://haveibeenpwned.com/API/Key lalu isi ke file .env.',
      alternatives: [
        {
          name: 'Firefox Monitor',
          url: `https://monitor.mozilla.org/?email=${encodeURIComponent(email)}`,
          note: 'Gratis, tanpa API key, berbasis Have I Been Pwned. Buka manual lalu catat hasilnya.',
        },
        {
          name: 'Google breach alert',
          url: 'https://www.google.com/alerts',
          note: 'Bisa diset untuk memantau kebocoran email tertentu.',
        },
      ],
    };
  }

  try {
    const url =
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}` +
      '?truncateResponse=true';

    const { status, json } = await requestJSON(url, {
      headers: { 'hibp-api-key': config.hibpKey },
      retries: 1,
      timeout: 15000,
    });

    if (status === 404) {
      return {
        ok: true,
        email,
        breached: false,
        breaches: [],
        note: 'Tidak ada kebocoran tercatat di HIBP untuk email ini.',
      };
    }
    if (status === 401 || status === 403) {
      return { ok: false, email, error: 'API key HIBP ditolak (401/403).' };
    }
    if (status === 429) {
      return { ok: false, email, error: 'Rate limit HIBP kena. Tunggu sebentar lalu coba lagi.' };
    }
    if (status !== 200) {
      return { ok: false, email, error: `HIBP HTTP ${status}` };
    }

    return {
      ok: true,
      email,
      breached: true,
      breachCount: json.length,
      breaches: json.map((b) => ({
        name: b.Name,
        domain: b.Domain,
        date: b.BreachDate,
        addedDate: b.AddedDate,
        pwnCount: b.PwnCount,
        description: b.Description?.replace(/<[^>]*>/g, '').slice(0, 300),
        dataClasses: b.DataClasses || [],
        source: `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(b.Name)}`,
      })),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, email, error: err.message };
  }
}

/**
 * Cek apakah satu kata sandi muncul di dataset HIBP (Pwned Passwords).
 * API ini gratis tanpa key — hanya butuh 5 digit pertama dari hash SHA-1
 * (k-anonimitas: server tidak pernah menerima kata sandi utuh).
 */
export async function checkPassword(pw = '') {
  const password = String(pw);
  if (password.length < 5) return { ok: false, error: 'Kata sandi terlalu pendek.' };

  const hash = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(password)
  );
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5).toUpperCase();

  try {
    const { status, text } = await request(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { headers: { 'Add-Padding': 'true', 'User-Agent': config.userAgent }, retries: 1 }
    );
    if (status !== 200) return { ok: false, error: `PwnedPasswords HTTP ${status}` };

    const hit = text.split('\n').find((line) => line.split(':')[0]?.trim() === suffix);
    const count = hit ? Number(hit.split(':')[1]?.trim() || 0) : 0;
    return {
      ok: true,
      breached: count > 0,
      count,
      note: count > 0
        ? 'Kata sandi ini sudah bocor. Ganti sekarang, di semua layanan yang dipakai.'
        : 'Tidak ditemukan di dataset Pwned Passwords (bukan jaminan aman, tapi bagus).',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ── Generator dork ───────────────────────────────────────────────────── */

const enc = (s) => encodeURIComponent(s);

/**
 * Buat daftar query siap tempel untuk Google/Bing yang menggabungkan
 * semua data yang diinput pengguna. Ini cara paling efektif menyatukan
 * username + nomor + nama + lokasi menjadi satu query yang tajam.
 */
export function buildDorks({ username = '', phone = '', name = '', location = '' }) {
  const u = username.replace(/^@/, '');
  const digits = phone.replace(/\D/g, '');
  const nm = name.trim();
  const loc = location.trim();

  const queries = [];

  if (u) {
    queries.push(
      { engine: 'Google', label: 'Username mentah', query: `"${u}"`, why: 'Semua kemunculan username di web.' },
      { engine: 'Google', label: 'Username di media sosial', query: `"${u}" (site:instagram.com OR site:tiktok.com OR site:twitter.com OR site:facebook.com)`, why: 'Prioritaskan akun media sosial.' },
      { engine: 'Google', label: 'Username + kontak', query: `"${u}" ("@gmail.com" OR "@yahoo.com" OR email)`, why: 'Cari email yang memakai username ini.' },
    );
  }

  if (digits) {
    queries.push(
      { engine: 'Google', label: 'Nomor mentah', query: `"${digits}"`, why: 'Semua jejak nomor di web publik.' },
      { engine: 'Google', label: 'Nomor + WA/Toko online', query: `"${digits}" ("whatsapp" OR "wa.me" OR "shopee" OR "tokopedia" OR "lazada")`, why: 'Cari jualan online / kontak bisnis.' },
      { engine: 'Google', label: 'Nomor + dokumen bocor', query: `"${digits}" (filetype:pdf OR filetype:xls OR filetype:doc)`, why: 'Nomor sering muncul di PDF kontrak/dokumen publik.' },
    );
  }

  if (nm) {
    const quoted = `"${nm}"`;
    queries.push(
      { engine: 'Google', label: 'Nama lengkap', query: quoted, why: 'Cek apakah nama unik atau umum.' },
      { engine: 'Google', label: 'Nama + platform', query: `${quoted} (site:linkedin.com OR site:instagram.com OR site:facebook.com)`, why: 'Kunci ke profil profesional & sosial.' },
    );
    if (loc) {
      queries.push(
        { engine: 'Google', label: 'Nama + lokasi (paling spesifik)', query: `${quoted} "${loc}"`, why: 'Kombinasi terkuat untuk pencarian identitas.' },
        { engine: 'Google', label: 'Nama + lokasi + kontak', query: `${quoted} "${loc}" (email OR "no hp" OR "whatsapp" OR "0812" OR "0821")`, why: 'Mencari kontak langsung dengan filter lokasi.' },
      );
    }
  }

  if (loc) {
    queries.push(
      { engine: 'Google', label: 'Lokasi saja', query: `"${loc}"`, why: 'Peta sosial / hotspot dari area tersebut.' },
    );
  }

  // Gabungan semua field — sering kali hasil terbaik untuk identity resolution.
  const combined = [nm && `"${nm}"`, u && `"${u}"`, digits && `"${digits}"`, loc && `"${loc}"`]
    .filter(Boolean)
    .join(' ');
  if (combined.split('"').length - 1 >= 4) {
    queries.push({ engine: 'Google', label: 'GABUNGAN semua field', query: combined, why: 'Potongan terbaik untuk identity resolution.' });
  }

  return {
    ok: true,
    count: queries.length,
    dorks: queries.map((q) => ({
      ...q,
      googleUrl: `https://www.google.com/search?q=${enc(q.query)}`,
      bingUrl: `https://www.bing.com/search?q=${enc(q.query)}`,
      duckduckgoUrl: `https://duckduckgo.com/?q=${enc(q.query)}`,
    })),
  };
}