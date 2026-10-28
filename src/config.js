/**
 * Konfigurasi global. Nilai diambil dari environment variable,
 * ada default yang aman sehingga server tetap jalan tanpa .env.
 */

// WAJIB pertama: memuat .env sebelum konfigurasi dibaca, supaya file ini
// bisa diimpor dari mana saja (server, test, skrip) tanpa harus selalu
// mengimpor loadenv.js lebih dulu.
import './loadenv.js';
import fs from 'node:fs';

/**
 * Versi diambil dari package.json supaya tidak pernah melenceng dari
 * /api/health, UI, dan dokumentasi. Kalau berkasnya tidak ada (mis. dipanggil
 * dari salinan parsial), jatuh ke 0.0.0 alih-alih melempar error.
 */
function readVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const bool = (v, dflt = false) => {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  // Versi tunggal untuk seluruh aplikasi (health check, UI, README).
  version: readVersion(),

  // Percayai header X-Forwarded-For hanya di belakang reverse proxy sendiri.
  // Default mati: tanpa proxy, header itu bisa dipalsukan klien.
  trustProxy: bool(process.env.TRUST_PROXY, false),

  contactName: process.env.CONTACT_NAME || 'Chameleon Console',
  contactEmail: process.env.CONTACT_EMAIL || 'admin@localhost',
  get userAgent() {
    return `${this.contactName}/1.0 (${this.contactEmail})`;
  },

  // Instagram/FB/b situs sering menolak User-Agent bot tanpa browser signature.
  browserUA:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',

  hibpKey: process.env.HIBP_API_KEY || '',

  // Numverify (apilayer.net) — validasi nomor terhadap database operator:
  // nama operator, tipe baris, negara, dan status porting. Opsional; tanpa
  // key modul phone-info tetap jalan memakai metadata offline.
  numverifyKey: process.env.NUMVERIFY_API_KEY || '',

  // Token Meta WhatsApp Cloud API.
  //
  // CATATAN PENTING: Cloud API TIDAK punya endpoint untuk mengecek apakah
  // nomor ACAK terdaftar di WhatsApp. Endpoint yang bisa diakses hanya
  // mengembalikan nomor bisnis milik Anda sendiri. Karena itu token ini
  // dipakai untuk memvalidasi kredensial + mengambil profil bisnis Anda,
  // BUKAN untuk menyatakan nomor target "terdaftar".
  meta: {
    waToken: process.env.META_WA_TOKEN || '',
    waPhoneId: process.env.META_PHONE_NUMBER_ID || '',
    graphVersion: process.env.META_GRAPH_VERSION || 'v19.0',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  // Maltego tidak mengekspos API publik untuk menulis entity ke graph yang
  // sedang berjalan (diverifikasi: port 61184 tidak ada di Maltego CE).
  // Satu-satunya jalur resmi untuk mendorong hasil ke graph hidup adalah
  // lewat Transform Provider, yang sudah ditangani modul maltego.js.
  maltego: {
    // URL Transform Provider yang dikonfigurasi di Maltego.
    providerUrl: process.env.MALTEGO_PROVIDER_URL || 'http://localhost:3000/api/maltego/transform',
  },

  // Batas concurrency supaya tidak ketiban rate limit situs target.
  concurrency: Number(process.env.CONCURRENCY || 12),
  timeoutMs: Number(process.env.TIMEOUT_MS || 12000),
  historyFile: process.env.HISTORY_FILE || 'data/history.jsonl',
};