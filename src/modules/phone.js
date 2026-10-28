/**
 * Modul nomor telepon: verifikasi WhatsApp, Telegram, profil operator,
 * dan BloodHound-style link ke platform lain.
 *
 * Catatan metode (penting agar hasilnya bisa dipertanggungjawabkan):
 *
 * 1. WhatsApp — TIDAK ada endpoint publik gratis yang andal. Halaman
 *    wa.me selalu redirect sama baik nomor terdaftar maupun tidak, jadi
 *    redirect tidak bisa dipakai sebagai sinyal. Yang kami lakukan:
 *      - kalau META_WA_TOKEN diisi: pakai Meta WhatsApp Cloud API (resmi).
 *      - selain itu: tandai "perlu verifikasi manual" + sertakan tautan
 *        wa.me agar operator bisa konfirmasi sekali klik di HP sendiri.
 *    Cara TUA yang biasa dipakai tool gratis (parse app_absent dari
 *    redirect) sudah tidak berlaku lagi per 2024 — jangan dipakai.
 *
 * 2. Telegram — publik: t.me/+<nomor> me-render halaman kontak. Kalau
 *    field judul/deskripsi kosong, nomor hampir pasti tidak terdaftar.
 *    Ini heuristik, bukan jaminan.
 *
 * 3. Operator & lokasi — dari metadata prefix (offline) + ip-api.com untuk
 *    lokasi Operator (kabupaten/kota) per nomor.
 */

import { config } from '../config.js';
import { request, requestJSON, stripTags } from '../util/http.js';
import {
  normalize,
  guessOperator,
  guessLineType,
  formatID,
} from '../util/phone.js';

/* ── WhatsApp ─────────────────────────────────────────────────────────── */

/**
 * Validasi kredensial WhatsApp Cloud API.
 *
 * Fungsi ini HANYA memeriksa apakah token Anda valid dan mengembalikan profil
 * nomor bisnis Anda sendiri. Cloud API tidak punya endpoint untuk mengecek
 * status pendaftaran nomor ACAK — itu tidak tersedia bagi integrator mana pun.
 *
 * Fungsi ini karena itu TIDAK PERNAH menyentuh status nomor target. Dulu
 * implementasi sini salah besar: ia memanggil /{phone-number-id}/ yang
 * mengembalikan display_phone_number milik ANDA, lalu menyimpulkan nomor
 * target "terdaftar" untuk input apa pun. Jalur yang mengarang jawaban seperti
 * itu akan merusak seluruh laporan, jadi implementasinya dihapus.
 */
export async function verifyMetaCredentials() {
  const { waToken, waPhoneId, graphVersion } = config.meta;
  if (!waToken || !waPhoneId) return { configured: false };

  try {
    const url =
      `https://graph.facebook.com/${graphVersion}/${waPhoneId}/` +
      `?fields=display_phone_number,verified_name,quality_rating&access_token=${encodeURIComponent(waToken)}`;

    const { status, json } = await requestJSON(url, { retries: 0, timeout: 12000 });

    if (status === 200 && json?.display_phone_number) {
      return {
        configured: true,
        valid: true,
        businessNumber: json.display_phone_number,
        verifiedName: json.verified_name || null,
        qualityRating: json.quality_rating || null,
        note:
          'Token valid. Ini profil nomor bisnis Anda sendiri — bukan hasil ' +
          'pemeriksaan nomor target.',
      };
    }

    if (status === 401 || status === 403) {
      return { configured: true, valid: false, error: `Token ditolak oleh Meta (HTTP ${status}).` };
    }
    return { configured: true, valid: false, error: `Meta membalas HTTP ${status}.` };
  } catch (err) {
    return { configured: true, valid: false, error: err.message };
  }
}

async function checkWhatsApp(e164) {
  const manualUrl = `https://wa.me/${e164.replace('+', '')}`;
  const creds = await verifyMetaCredentials().catch(() => ({ configured: false }));

  return {
    platform: 'WhatsApp',
    status: 'needs_manual',
    confidence: 'none',
    method: 'tautan verifikasi manual',
    url: manualUrl,
    note:
      'Meta tidak menyediakan endpoint publik untuk cek nomor, dan WhatsApp ' +
      'Cloud API juga tidak bisa mengecek nomor acak — hanya nomor bisnis Anda ' +
      'sendiri. Klik tautan: bila WhatsApp terbuka ke chat, nomor terdaftar; ' +
      'bila muncul "nomor tidak terdaftar di WhatsApp", berarti belum.',
    meta: creds.configured
      ? {
          credentialsValid: creds.valid,
          businessNumber: creds.businessNumber || null,
          detail: creds.error || creds.note,
        }
      : null,
  };
}

/* ── Telegram ─────────────────────────────────────────────────────────── */

async function checkTelegram(e164) {
  const digits = e164.replace('+', '');
  const url = `https://t.me/+${digits}`;

  let res;
  try {
    res = await request(url, { browserUA: true, timeout: 15000, retries: 2 });
  } catch (err) {
    // Telegram diblokir atau tidak bisa dihubungi dari jaringan ini — kondisi
    // yang sangat umum, bukan kegagalan modul. Jangan laporkan sebagai error;
    // laporkan sebagai "tidak bisa diperiksa" supaya tidak disalahartikan
    // sebagai "tidak terdaftar".
    return {
      platform: 'Telegram',
      status: 'unreachable',
      confidence: 'none',
      method: 't.me/+nomor',
      url,
      note:
        `Server tidak bisa menghubungi t.me dari jaringan ini (${err.message}). ` +
        'Telegram sering diblokir di beberapa jaringan/negara. Ini BUKAN berarti ' +
        'nomor tidak terdaftar — buka tautan di bawah dari browser untuk memeriksa manual.',
    };
  }

  const { status, text } = res;

  if (status !== 200) {
    return {
      platform: 'Telegram',
      status: 'unknown',
      confidence: 'low',
      method: 't.me/+nomor',
      url,
      note: `Respons HTTP ${status} dari t.me.`,
    };
  }

  // Halaman kontak Telegram punya tgme_page_title/description. Kalau kosong
  // -> nomor tidak ada di Telegram. Kalau terisi -> ada kontak yang bisa dibuka.
  const title = (text.match(/tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
  const desc = (
    text.match(/tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i) || []
  )[1];
  const displayName = stripTags(title || '');
  const bio = stripTags(desc || '');

  const registered = Boolean(displayName);
  return {
    platform: 'Telegram',
    status: registered ? 'registered' : 'not_registered',
    confidence: 'medium',
    method: 't.me/+nomor (heuristik)',
    url,
    displayName: displayName || null,
    bio: bio || null,
    note: registered
      ? 'Telegram menampilkan halaman kontak — nomor kemungkinan terdaftar.'
      : 'Telegram menampilkan halaman kosong — nomor kemungkinan tidak terdaftar.',
  };
}

/* ── Lokasi / operator ────────────────────────────────────────────────── */

/**
 * ip-api.com memetakan IP honeycomb operator ke koordinat. Untuk operator
 * seluler ID, ini memberi perkiraan kab/kota tempat nomor didaftarkan
 * (bukan lokasi pemakaian saat ini).
 */
async function lookupCarrierLocation(e164) {
  const { national } = normalize(e164);
  try {
    const { status, json } = await requestJSON(
      `http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,isp,query&query=${encodeURIComponent(national)}`,
      { retries: 0, timeout: 8000 }
    );
    if (status !== 200 || json.status !== 'success') return null;
    return {
      country: json.country,
      region: json.regionName,
      city: json.city,
      lat: json.lat,
      lon: json.lon,
      isp: json.isp,
      note: 'Perkiraan lokasi pendaftaran/operator, bukan lokasi pemakaian real-time.',
    };
  } catch {
    return null;
  }
}

/* ── Platform lain ───────────────────────────────────────────────────── */

function messagingLinks(e164) {
  const digits = e164.replace('+', '');
  return [
    {
      platform: 'WhatsApp',
      url: `https://wa.me/${digits}`,
      note: 'Buka untuk konfirmasi manual nomor terdaftar atau tidak.',
    },
    {
      platform: 'Telegram',
      url: `https://t.me/+${digits}`,
      note: 'Halaman kontak publik Telegram.',
    },
    {
      platform: 'Signal',
      url: `https://signal.org/#p/+${digits}`,
      note: 'Signal tidak punya cek nomor publik — pakai ini hanya untuk kontak manual.',
    },
    {
      platform: 'SMS (browser)',
      url: `sms:${digits}`,
      note: 'Shortcut membuka compose SMS (hanya lokal, tidak mengirim).',
    },
    {
      platform: 'Google (dork nomor)',
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${digits}"`)}`,
      note: 'Cari jejak nomor di halaman web publik.',
    },
    {
      platform: 'Hollowsearch',
      url: `https://hollowsearch.com/search?query=${encodeURIComponent(digits)}`,
      note: 'Mesin pencari metadata/arsip.',
    },
  ];
}

/* ── Entry point ──────────────────────────────────────────────────────── */

export async function investigatePhone(rawInput) {
  const parsed = normalize(rawInput);
  if (!parsed) {
    return {
      ok: false,
      error: `Nomor tidak valid / tidak bisa dinormalisasi: "${rawInput}". ` +
        `Gunakan format 08xx..., +62xx..., atau 62xx...`,
    };
  }

  const { e164, cc, national } = parsed;

  const [whatsapp, telegram, location] = await Promise.all([
    checkWhatsApp(e164).catch((err) => ({
      platform: 'WhatsApp',
      status: 'error',
      note: err.message,
    })),
    checkTelegram(e164).catch((err) => ({
      platform: 'Telegram',
      status: 'unreachable',
      confidence: 'none',
      note: err.message,
    })),
    lookupCarrierLocation(e164).catch(() => null),
  ]);

  return {
    ok: true,
    input: rawInput,
    e164,
    national,
    countryCode: cc,
    display: formatID(e164),
    operator: guessOperator(e164),
    lineType: guessLineType(e164),
    operatorLocation: location,
    checks: { whatsapp, telegram },
    links: messagingLinks(e164),
    generatedAt: new Date().toISOString(),
  };
}