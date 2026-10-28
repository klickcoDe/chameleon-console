/**
 * Modul "Info Nomor Lengkap" — padanan phone_number_cheker (libphonenumber)
 * dan route /api/osint/phone di OSIRIS.
 *
 * Yang dijawab modul ini:
 *   "Nomor ini dari negara mana, operator siapa, jenis baris apa, area
 *    pendaftaran di mana, dan jam berapa sekarang di sana?"
 *
 * BATAS YANG WAJIB DISAMPINGI (bukan disembunyikan):
 *   Lokasi real-time / GPS TIDAK bisa diperoleh dari nomor telepon.
 *   Yang bisa dihitung hanya area pendaftaran (kode area atau zona waktu
 *   prefix). Modul ini menulis "perkiraan" di mana pun itu yang terjadi dan
 *   tidak pernah menampilkan titik koordinat seolah-olah itu lokasi device.
 *
 * Sumber:
 *   - Offline: src/util/phone-meta.js (metadata E.164 + kode area Indonesia)
 *   - Opsional: Numverify API (kalau NUMVERIFY_API_KEY diisi) untuk
 *     validasi operator, tipe baris, dan status porting.
 */

import { requestJSON } from '../util/http.js';
import { normalize, guessOperator } from '../util/phone.js';
import {
  analyzeNumber,
  indonesiaArea,
  localTimeIn,
  utcOffsetHours,
  formatNational,
  countryByCode,
} from '../util/phone-meta.js';
import { config } from '../config.js';

/**
 * Validasi tambahan lewat Numverify (opsional, butuh key).
 *
 * Yang dikembalikan API ini: nama operator, tipe baris, negara, dan
 * occasionally apakah nomor sudah di-porting (ditransfer antar operator).
 * Tidak ada nama pemilik di sini — jadi tidak ada risiko "nama dikarang".
 */
async function checkNumverify(e164, digits) {
  if (!config.numverifyKey) {
    return { checked: false, note: 'Numverify tidak dikonfigurasi (NUMVERIFY_API_KEY kosong).' };
  }

  try {
    const { status, json } = await requestJSON(
      `http://apilayer.net/api/validate?access_key=${encodeURIComponent(config.numverifyKey)}` +
        `&number=${encodeURIComponent(digits)}`,
      { retries: 1, timeout: 12000 }
    );

    if (status !== 200 || !json) {
      return { checked: false, note: `Numverify HTTP ${status}` };
    }
    if (json.error) {
      return { checked: false, note: `Numverify: ${json.error.info || json.error.type || 'error'}` };
    }

    return {
      checked: true,
      valid: json.valid ?? null,
      countryCode: json.country_code || null,
      countryName: json.country_name || null,
      location: json.location || null,
      carrier: json.carrier || null,
      lineType: json.line_type || null,
      ported: json.ported ?? null,
      callerName: json.caller_name || null,
      callerType: json.caller_type || null,
      note:
        'Numverify memvalidasi nomor terhadap database operator. "caller_name" di sini ' +
        'adalah nama yang DIILEGITIMASI oleh operator untuk identifikasi caller (bisa dipakai ' +
        'untuk caller ID layanan), BUKAN nama kontak yang disimpan pengguna.',
    };
  } catch (err) {
    return { checked: false, note: `Numverify gagal: ${err.message}` };
  }
}

/**
 * Entry point: profil lengkap satu nomor telepon.
 *
 * @param {string} rawNumber
 */
export async function phoneInfo(rawNumber) {
  const parsed = normalize(rawNumber);
  if (!parsed) {
    return {
      ok: false,
      error:
        `Nomor tidak valid / tidak bisa dinormalisasi: "${rawNumber}". ` +
        'Gunakan format 08xx..., +62xx..., atau 62xx...',
    };
  }

  const { e164, national, digits } = parsed;
  const analysis = analyzeNumber(e164);

  if (!analysis) {
    return {
      ok: false,
      number: e164,
      error: `Kode negara "${parsed.cc}" tidak dikenal. Tabel metadata hanya mencakup negara yang lazim dipakai; angka tersebut belum tercakup.`,
    };
  }

  // analyzeNumber() sudah memisahkan kode negara (tanpa '+') dari NSN.
  const cc = analysis.cc;

  // Untuk Indonesia: peta area pendaftaran (kode area -> kota).
  const idArea = cc === '62' ? indonesiaArea(digits.slice(2)) : null;

  // Zona waktu: untuk Indonesia pakai peta prefix (kasar), untuk negara lain
  // pakai zona waktu utama negara (lebih kasar lagi, tapi tidak mengarang).
  const timezone = idArea?.zone || analysis.timezone;
  const zoneConfidence =
    cc === '62' ? idArea?.zoneConfidence || 'default' : 'country_level';

  const operator = guessOperator(e164);

  const numverify = await checkNumverify(e164, digits).catch((err) => ({
    checked: false,
    note: err.message,
  }));

  const typeLabel = {
    mobile: 'Seluler',
    fixed: 'Landline / telpon tetap',
    fixed_or_unknown: 'Kemungkinan garis tetap (awalan seluler tidak dikenali)',
    toll_free: 'Toll-free',
    premium: 'Premium / layanan khusus',
    mobile_or_fixed: 'Seluler atau tetap (NANP — tidak bisa dibedakan dari nomor saja)',
    unknown: 'Tidak diketahui',
  }[analysis.type] || 'Tidak diketahui';

  return {
    ok: true,
    input: rawNumber,
    number: e164,
    national: national,
    display: formatNational(cc, analysis.nsn, idArea?.area?.code),
    countryCode: cc,
    country: analysis.country,
    countryIso: analysis.iso,
    region: idArea?.area?.province || null,
    city: idArea?.area?.city || null,
    coordinates: idArea?.area
      ? { lat: idArea.area.lat, lon: idArea.area.lon, accuracy: 'kota/kabupaten (kode area)' }
      : null,
    areaCode: idArea?.area?.code || null,
    operator,
    lineType: typeLabel,
    lineTypeRaw: analysis.type,
    validity: {
      possible: analysis.possible,
      valid: analysis.valid,
      length: analysis.nsnLength,
      expectedLength: analysis.nationalLengthRange,
      note:
        '"possible" = panjang nomor masuk rentang yang lazim di negara tersebut. ' +
        '"valid" = nomor cocok dengan pola awalan yang dikenal. Keduanya BUKAN bukti ' +
        'nomor aktif — nomor aktif hanya bisa dipastikan dengan menelepon/mengecek manual.',
    },
    location: {
      timezone,
      utcOffset: utcOffsetHours(timezone),
      localTime: localTimeIn(timezone),
      confidence:
        zoneConfidence === 'high'
          ? 'tinggi (kode area)'
          : zoneConfidence === 'low'
            ? 'rendah (perkiraan prefix)'
            : zoneConfidence === 'country_level'
              ? 'negara (perkiraan kasar)'
              : 'nilai bawaan',
      accuracy:
        'Ini area/zona waktu PENDAFTARAN atau negara asal — BUKAN posisi perangkat ' +
        'saat ini. Pelacakan GPS dari nomor telepon tidak tersedia untuk publik ' +
        '(data HLR/LBS milik operator dan tidak dipublikasikan). Untuk nomor seluler, ' +
        'prefix TIDAK terikat wilayah: nomor bisa dipakai di luar wilayah alokasi ' +
        'awal dan bisa diporting antar operator, jadi tebakan zona waktu seluler ' +
        'hanya perkiraan lemah.',
    },
    numverify,
    note:
      'Profil ini disusun dari metadata E.164 publik + prefiks operator. Untuk nomor ' +
      'seluler, area kota TIDAK bisa diturunkan dari prefix — alokasi seluler tidak ' +
      'memuat kode area, jadi modul ini sengaja tidak menampilkan kota untuk nomor seluler.',
    generatedAt: new Date().toISOString(),
  };
}

export const phoneInfoTools = [
  { id: 'phone-info', label: 'Info Nomor & Lokasi', needs: 'phone' },
];
