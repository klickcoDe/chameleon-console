/**
 * Normalisasi & validasi nomor telepon.
 *
 * Fokus: Indonesia (62) karena sebagian besar target bersifat lokal, tetapi
 * struktur E.164 yang sama juga berlaku untuk negara lain. Prefix operator ID
 * dipetakan manual karena tidak ada API publik gratis yang andal untuk itu
 * (VeriPhone sudah dimatikan).
 */

const ID_CC = '62';

/** Buang semua karakter selain digit, lalu pertahankan tanda '+' di depan. */
export function cleanInput(raw = '') {
  const s = String(raw).trim();
  const hasPlus = /^\s*\+/.test(s);
  const digits = s.replace(/\D/g, '');
  return { digits, hasPlus };
}

/**
 * Ubah input bebas ("0812 3456 7890", "+62 812-...", "62812...") menjadi E.164.
 * Mengembalikan null bila bukan nomor telepon yang masuk akal.
 */
export function normalize(raw) {
  const { digits, hasPlus } = cleanInput(raw);
  if (!digits) return null;

  // 1. Susun dulu seluruh digit dalam bentuk E.164 (tanpa tanda +).
  let e164Digits;

  if (hasPlus) {
    e164Digits = digits;
  } else if (digits.startsWith('0')) {
    // Format Indonesia: 08xx -> +62 8xx
    e164Digits = ID_CC + digits.replace(/^0+/, '');
  } else if (digits.startsWith('62') && digits.length >= 11 && digits.length <= 15) {
    // Sudah pakai kode negara Indonesia.
    e164Digits = digits;
  } else if (digits.startsWith('8') && digits.length >= 10 && digits.length <= 13) {
    // Seluler Indonesia tanpa awalan 0 dan tanpa kode negara (mis. 81234567890).
    e164Digits = ID_CC + digits;
  } else if (digits.length >= 8 && digits.length <= 10) {
    // Nomor lokal tanpa '0' -> anggap Indonesia.
    e164Digits = ID_CC + digits;
  } else {
    return null;
  }

  // 2. Panjang nomor internasional wajar: 7-15 digit total (ITU-T E.164).
  if (e164Digits.length < 7 || e164Digits.length > 15) return null;
  if (!/^\d{7,15}$/.test(e164Digits)) return null;

  const ccDigits = e164Digits.slice(0, 2);
  const nationalDigits = e164Digits.slice(2);

  return {
    e164: `+${e164Digits}`,
    cc: `+${ccDigits}`,
    national: `0${nationalDigits}`,
    digits: e164Digits,
    hasPlus,
  };
}

/**
 * Daftar operator Indonesia (mulai 2024, setelah migrasi ke format 8xx).
 * Sumber:/public references endowment Telkomsel/Indosat/XL/AXIS/Smartfren/
 * By.U. Jika prefix tidak dikenal, operator = null (tidak ditebak).
 */
const OPERATORS = [
  // Format lama (8 digit)
  [/^081[1-35-8]$/, 'Telkomsel (SimPATI/KartuHalo)'],
  [/^082[1-8]$/, 'Telkomsel (SimPATI)'],
  [/^083[18]$/, 'Telkomsel (SimPATI)'],
  [/^085[123]$/, 'Telkomsel (SimPATI)'],
  [/^086[1246]$/, 'Telkomsel (SimPATI)'],
  [/^087[78]$/, 'Telkomsel (SimPATI)'],
  [/^081[2469]$/, 'Telkomsel (by.U)'],
  [/^082[17]$/, 'Telkomsel (by.U)'],
  [/^085[15]$/, 'Telkomsel (by.U)'],
  [/^088[2-9]$/, 'Telkomsel (by.U)'],
  [/^0819$/, 'Telkomsel (by.U)'],

  [/^0821[1-4]$/, 'Indosat (IM3)'],
  [/^0821[57]$/, 'Indosat (IM3 Ooredoo)'],
  [/^0822[129]$/, 'Indosat (IM3)'],
  [/^0823$/, 'Indosat (IM3)'],
  [/^0851[0-9]$/, 'Indosat (IM3)'],
  [/^0852[0-6]$/, 'Indosat (IM3)'],
  [/^0857[12]$/, 'Indosat (IM3)'],
  [/^08576[0-9]$/, 'Indosat (IM3)'],

  [/^0877[12]$/, 'XL (Axis)'],
  [/^0878[0-9]$/, 'XL (Axis)'],
  [/^0878[2-4]$/, 'XL (Axis)'],
  [/^08786[45]$/, 'XL (Axis)'],
  [/^0819[0-8]$/, 'XL (Axis)'],

  [/^0813[1-9]$/, 'by.U (Telkomsel)'],

  [/^0838[0-9]$/, 'AXIS'],
  [/^0831[123]$/, 'AXIS'],
  [/^0832$/, 'AXIS'],

  [/^084[3-9]$/, 'Smartfren'],
  [/^0822[0-9]{2}$/, 'Smartfren'],

  // Format baru 8xx (mulai 2024)
  [/^0811$/, 'Telkomsel'],
  [/^0812$/, 'Telkomsel'],
  [/^0813$/, 'Telkomsel / by.U'],
  [/^0814$/, 'Indosat'],
  [/^0815$/, 'Telkomsel'],
  [/^0816$/, 'Smartfren'],
  [/^0817$/, 'by.U'],
  [/^0818$/, 'XL'],
  [/^0819$/, 'XL'],

  [/^085[1-9]$/, 'Berbagai operator'],
  [/^086[1-9]$/, 'Berbagai operator'],
  [/^087[0-9]$/, 'Berbagai operator'],
  [/^088[0-9]$/, 'Berbagai operator'],
];

/** Tebakan operator berdasarkan awalan nomor (hanya untuk nomor Indonesia). */
export function guessOperator(e164) {
  if (!e164 || !e164.startsWith('+62')) return null;
  const local = '0' + e164.slice(3); // +62xxx -> 08xx
  for (const [re, name] of OPERATORS) {
    if (re.test(local)) return name;
  }
  // Prefix umum: awalan 3-4 digit yang paling sering muncul.
  const p3 = local.slice(0, 3);
  const p4 = local.slice(0, 4);
  for (const [re, name] of OPERATORS) {
    if (re.test(p3) || re.test(p4)) return name;
  }
  return null;
}

/** Deteksi tipe produk: seluler / landline / toll-free. */
export function guessLineType(e164) {
  if (!e164) return null;
  if (e164.startsWith('+62')) return 'mobile (asumsi)';
  if (/^\+800/.test(e164)) return 'toll-free';
  if (/^\+90/.test(e164)) return 'mobile';
  return 'unknown';
}

/** Format tampilan Indonesia: +6281234567890 -> 0812-3456-7890 */
export function formatID(e164) {
  if (!e164 || !e164.startsWith('+62')) return e164;
  const rest = e164.slice(3);
  return `0${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`.slice(0, 15);
}

export const isValid = (raw) => normalize(raw) !== null;