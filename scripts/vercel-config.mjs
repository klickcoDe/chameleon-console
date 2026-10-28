/**
 * Build step untuk deployment UI di Vercel.
 *
 * Menulis public/config.js dari environment variable CHAMELEON_API_URL,
 * sehingga alamat backend tidak perlu di-hardcode di repo dan bisa berbeda
 * antara preview dan production.
 *
 * Pakai:
 *   CHAMELEON_API_URL=https://api.contoh.com node scripts/vercel-config.mjs
 *
 * Gagal dengan pesan jelas bila variabelnya kosong: UI tanpa apiBase akan
 * memanggil /api/... ke Vercel (yang tidak punya backend) dan tampak rusak.
 */

import fs from 'node:fs';

const RAW = process.env.CHAMELEON_API_URL || '';
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_API === '1';
const target = new URL('../public/config.js', import.meta.url);

const base = RAW.trim().replace(/\/+$/, '');

if (!base) {
  if (!ALLOW_EMPTY) {
    console.error(
      '\n[vercel-config] CHAMELEON_API_URL belum diisi.\n' +
        '  Set di Vercel: Project > Settings > Environment Variables\n' +
        '  Contoh: CHAMELEON_API_URL=https://api.contoh.com\n' +
        '  (untuk build UI lokal tanpa API, pakai ALLOW_EMPTY_API=1)\n'
    );
    process.exit(1);
  }
  console.warn('[vercel-config] CHAMELEON_API_URL kosong — UI akan memakai origin yang sama.');
} else {
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    console.error(`[vercel-config] CHAMELEON_API_URL bukan URL valid: "${base}"`);
    process.exit(1);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    console.error(`[vercel-config] Protokol harus http/https, bukan "${parsed.protocol}"`);
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && process.env.VERCEL_ENV === 'production') {
    console.warn(
      '[vercel-config] PERINGATAN: backend http:// di UI https:// akan diblokir ' +
        'browser (mixed content). Gunakan HTTPS di backend.'
    );
  }
}

const content = `/* Dibuat otomatis oleh scripts/vercel-config.mjs saat build — jangan diedit manual. */
window.CHAMELEON_CONFIG = { apiBase: ${JSON.stringify(base)} };
`;

fs.writeFileSync(target, content);
console.log(`[vercel-config] public/config.js -> apiBase: ${base || '(origin yang sama)'}`);
