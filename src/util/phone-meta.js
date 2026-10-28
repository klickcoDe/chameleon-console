/**
 * Metadata nomor telepon — versi ringan & OFFLINE dari libphonenumber.
 *
 * Kenapa file ini ada:
 *   Referensi yang dipakai pengguna (github.com/xor722/phone_number_cheker)
 *   memakai pustaka `phonenumbers` (port Python dari libphonenumber Google)
 *   untuk menghasilkan: zona waktu, operator, lokasi, validitas, dan
 *   "possible number". Proyek ini sengaja tanpa dependensi, jadi dataset
 *   yang sama di-port ke bentuk ringkas di sini.
 *
 * Yang TIDAK ada di sini (sengaja):
 *   - Tidak ada pelacakan GPS. Tidak ada tool publik yang bisa memetakan
 *     posisi perangkat dari nomor telepon saja — ITU/operator menutup data
 *     itu untuk alasan privasi. Yang bisa dihitung adalah WILAYAH DAFTAR
 *     (area code / prefix operator), bukan lokasi pemakaian saat ini.
 *   - Tidak ada data HLR. Lokasi kota yang sebenarnya hanya ada di Home
 *     Location Register operator (data privat, dipolejasa).
 *
 * Yang dikembalikan:
 *   - negara + zona waktu (dari kode negara ITU-T E.164)
 *   - perkiraan area pendaftaran (kode area / prefix)
 *   - tipe baris (mobile / fixed / toll-free / premium)
 *   - validitas & "possible" (berdasarkan pola panjang + awalan)
 *
 * Seluruh isi tabel di bawah adalah data publik dan standar
 * (ITU-T E.164 + alokasi prefiks operator yang dipublikasikan).
 */

/* ── Tabel kode negara ────────────────────────────────────────────────── */

/**
 * Setiap entri:
 *   cc   : kode negara tanpa '+'
 *   iso  : ISO 3166-1 alpha-2 (untuk nama negara otomatis + geocode)
 *   tz   : zona waktu IANA utama di negara itu
 *   len  : [min, max] panjang "national significant number" (tanpa kode negara)
 *   mob  : awalan angka yang menandai nomor seluler (best effort)
 *   toll : awalan nomor toll-free
 */
const COUNTRY_META = {
  '1':  { iso: 'US', tz: 'America/New_York', len: [10, 10], nanp: true },
  '7':  { iso: 'RU', tz: 'Europe/Moscow', len: [10, 10], mob: ['9'] },
  '20': { iso: 'EG', tz: 'Africa/Cairo', len: [8, 10], mob: ['10', '11', '12', '15'] },
  '27': { iso: 'ZA', tz: 'Africa/Johannesburg', len: [9, 9], mob: ['6', '7', '8'] },
  '30': { iso: 'GR', tz: 'Europe/Athens', len: [10, 10], mob: ['6'] },
  '31': { iso: 'NL', tz: 'Europe/Amsterdam', len: [9, 9], mob: ['6'] },
  '32': { iso: 'BE', tz: 'Europe/Brussels', len: [8, 9], mob: ['4'] },
  '33': { iso: 'FR', tz: 'Europe/Paris', len: [9, 9], mob: ['6', '7'] },
  '34': { iso: 'ES', tz: 'Europe/Madrid', len: [9, 9], mob: ['6', '7'] },
  '36': { iso: 'HU', tz: 'Europe/Budapest', len: [8, 9], mob: ['20', '30', '31', '50', '70'] },
  '39': { iso: 'IT', tz: 'Europe/Rome', len: [9, 11], mob: ['3'] },
  '40': { iso: 'RO', tz: 'Europe/Bucharest', len: [9, 9], mob: ['7'] },
  '41': { iso: 'CH', tz: 'Europe/Zurich', len: [9, 9], mob: ['7'] },
  '43': { iso: 'AT', tz: 'Europe/Vienna', len: [7, 11], mob: ['6'] },
  '44': { iso: 'GB', tz: 'Europe/London', len: [9, 10], mob: ['7'] },
  '45': { iso: 'DK', tz: 'Europe/Copenhagen', len: [8, 8] },
  '46': { iso: 'SE', tz: 'Europe/Stockholm', len: [7, 10], mob: ['7'] },
  '47': { iso: 'NO', tz: 'Europe/Oslo', len: [8, 8], mob: ['4', '9'] },
  '48': { iso: 'PL', tz: 'Europe/Warsaw', len: [9, 9], mob: ['5', '6', '7', '8'] },
  '49': { iso: 'DE', tz: 'Europe/Berlin', len: [6, 11], mob: ['15', '16', '17'] },
  '51': { iso: 'PE', tz: 'America/Lima', len: [8, 9], mob: ['9'] },
  '52': { iso: 'MX', tz: 'America/Mexico_City', len: [10, 10] },
  '53': { iso: 'CU', tz: 'America/Havana', len: [6, 8] },
  '54': { iso: 'AR', tz: 'America/Argentina/Buenos_Aires', len: [10, 10], mob: ['9'] },
  '55': { iso: 'BR', tz: 'America/Sao_Paulo', len: [10, 11], mob: ['9'] },
  '56': { iso: 'CL', tz: 'America/Santiago', len: [8, 9], mob: ['9'] },
  '57': { iso: 'CO', tz: 'America/Bogota', len: [10, 10], mob: ['3'] },
  '58': { iso: 'VE', tz: 'America/Caracas', len: [10, 10] },
  '60': { iso: 'MY', tz: 'Asia/Kuala_Lumpur', len: [9, 10], mob: ['1'] },
  '61': { iso: 'AU', tz: 'Australia/Sydney', len: [9, 9], mob: ['4'], toll: ['180'] },
  '62': { iso: 'ID', tz: 'Asia/Jakarta', len: [9, 12], mob: ['8'], fix: ['2', '3', '4', '5', '6', '7'], toll: ['0800'] },
  '63': { iso: 'PH', tz: 'Asia/Manila', len: [10, 10], mob: ['9'] },
  '64': { iso: 'NZ', tz: 'Pacific/Auckland', len: [8, 10], mob: ['2'] },
  '65': { iso: 'SG', tz: 'Asia/Singapore', len: [8, 8], mob: ['8', '9'] },
  '66': { iso: 'TH', tz: 'Asia/Bangkok', len: [9, 9], mob: ['6', '8', '9'] },
  '81': { iso: 'JP', tz: 'Asia/Tokyo', len: [9, 10], mob: ['70', '80', '90'] },
  '82': { iso: 'KR', tz: 'Asia/Seoul', len: [9, 10], mob: ['10'] },
  '84': { iso: 'VN', tz: 'Asia/Ho_Chi_Minh', len: [9, 10], mob: ['3', '5', '7', '8', '9'] },
  '86': { iso: 'CN', tz: 'Asia/Shanghai', len: [9, 11], mob: ['13', '14', '15', '16', '17', '18', '19'] },
  '90': { iso: 'TR', tz: 'Europe/Istanbul', len: [10, 10], mob: ['5'] },
  '91': { iso: 'IN', tz: 'Asia/Kolkata', len: [10, 10], mob: ['6', '7', '8', '9'] },
  '92': { iso: 'PK', tz: 'Asia/Karachi', len: [9, 11], mob: ['3'] },
  '93': { iso: 'AF', tz: 'Asia/Kabul', len: [9, 9], mob: ['7'] },
  '94': { iso: 'LK', tz: 'Asia/Colombo', len: [9, 9], mob: ['7'] },
  '95': { iso: 'MM', tz: 'Asia/Yangon', len: [8, 10], mob: ['9'] },
  '98': { iso: 'IR', tz: 'Asia/Tehran', len: [10, 10], mob: ['9'] },
  '211': { iso: 'SS', tz: 'Africa/Juba', len: [9, 9] },
  '212': { iso: 'MA', tz: 'Africa/Casablanca', len: [9, 9], mob: ['6', '7'] },
  '213': { iso: 'DZ', tz: 'Africa/Algiers', len: [9, 9], mob: ['6', '7'] },
  '216': { iso: 'TN', tz: 'Africa/Tunis', len: [8, 8], mob: ['2', '4', '5', '9'] },
  '218': { iso: 'LY', tz: 'Africa/Tripoli', len: [9, 9], mob: ['9'] },
  '220': { iso: 'GM', tz: 'Africa/Banjul', len: [7, 7] },
  '221': { iso: 'SN', tz: 'Africa/Dakar', len: [9, 9] },
  '233': { iso: 'GH', tz: 'Africa/Accra', len: [9, 9], mob: ['2', '5'] },
  '234': { iso: 'NG', tz: 'Africa/Lagos', len: [10, 10], mob: ['70', '80', '81', '90', '91'] },
  '251': { iso: 'ET', tz: 'Africa/Addis_Ababa', len: [9, 9], mob: ['9'] },
  '254': { iso: 'KE', tz: 'Africa/Nairobi', len: [9, 9], mob: ['1', '7'] },
  '255': { iso: 'TZ', tz: 'Africa/Dar_es_Salaam', len: [9, 9], mob: ['6', '7'] },
  '256': { iso: 'UG', tz: 'Africa/Kampala', len: [9, 9], mob: ['7'] },
  '260': { iso: 'ZM', tz: 'Africa/Lusaka', len: [9, 9], mob: ['9'] },
  '263': { iso: 'ZW', tz: 'Africa/Harare', len: [9, 9], mob: ['7'] },
  '264': { iso: 'NA', tz: 'Africa/Windhoek', len: [9, 9], mob: ['8'] },
  '265': { iso: 'MW', tz: 'Africa/Blantyre', len: [9, 9], mob: ['88', '99'] },
  '266': { iso: 'LS', tz: 'Africa/Maseru', len: [8, 8] },
  '267': { iso: 'BW', tz: 'Africa/Gaborone', len: [7, 8] },
  '268': { iso: 'SZ', tz: 'Africa/Mbabane', len: [8, 8] },
  '351': { iso: 'PT', tz: 'Europe/Lisbon', len: [9, 9], mob: ['9'] },
  '352': { iso: 'LU', tz: 'Europe/Luxembourg', len: [6, 9] },
  '353': { iso: 'IE', tz: 'Europe/Dublin', len: [7, 9], mob: ['8'] },
  '354': { iso: 'IS', tz: 'Atlantic/Reykjavik', len: [7, 7] },
  '355': { iso: 'AL', tz: 'Europe/Tirane', len: [8, 9], mob: ['6'] },
  '356': { iso: 'MT', tz: 'Europe/Malta', len: [8, 8] },
  '357': { iso: 'CY', tz: 'Asia/Nicosia', len: [8, 8] },
  '358': { iso: 'FI', tz: 'Europe/Helsinki', len: [5, 10], mob: ['4', '5'] },
  '359': { iso: 'BG', tz: 'Europe/Sofia', len: [8, 9], mob: ['87', '88', '89', '98', '99'] },
  '370': { iso: 'LT', tz: 'Europe/Vilnius', len: [8, 8] },
  '371': { iso: 'LV', tz: 'Europe/Riga', len: [8, 8] },
  '372': { iso: 'EE', tz: 'Europe/Tallinn', len: [7, 8] },
  '373': { iso: 'MD', tz: 'Europe/Chisinau', len: [8, 8], mob: ['6', '7'] },
  '374': { iso: 'AM', tz: 'Asia/Yerevan', len: [8, 8], mob: ['3', '4', '5', '7', '9'] },
  '375': { iso: 'BY', tz: 'Europe/Minsk', len: [9, 9], mob: ['25', '29', '33', '44'] },
  '376': { iso: 'AD', tz: 'Europe/Andorra', len: [6, 6] },
  '377': { iso: 'MC', tz: 'Europe/Monaco', len: [8, 9], mob: ['4', '6'] },
  '378': { iso: 'SM', tz: 'Europe/San_Marino', len: [8, 10] },
  '380': { iso: 'UA', tz: 'Europe/Kyiv', len: [9, 9], mob: ['39', '50', '63', '66', '67', '68', '9'] },
  '381': { iso: 'RS', tz: 'Europe/Belgrade', len: [8, 9], mob: ['6'] },
  '382': { iso: 'ME', tz: 'Europe/Podgorica', len: [8, 8] },
  '383': { iso: 'XK', tz: 'Europe/Belgrade', len: [8, 9] },
  '385': { iso: 'HR', tz: 'Europe/Zagreb', len: [8, 9], mob: ['9'] },
  '386': { iso: 'SI', tz: 'Europe/Ljubljana', len: [8, 8] },
  '387': { iso: 'BA', tz: 'Europe/Sarajevo', len: [8, 8] },
  '389': { iso: 'MK', tz: 'Europe/Skopje', len: [8, 8] },
  '420': { iso: 'CZ', tz: 'Europe/Prague', len: [9, 9], mob: ['6', '7'] },
  '421': { iso: 'SK', tz: 'Europe/Bratislava', len: [9, 9], mob: ['9'] },
  '423': { iso: 'LI', tz: 'Europe/Vaduz', len: [7, 9] },
  '500': { iso: 'FK', tz: 'Atlantic/Stanley', len: [5, 5] },
  '501': { iso: 'BZ', tz: 'America/Belize', len: [7, 7] },
  '502': { iso: 'GT', tz: 'America/Guatemala', len: [8, 8] },
  '503': { iso: 'SV', tz: 'America/El_Salvador', len: [8, 8] },
  '504': { iso: 'HN', tz: 'America/Tegucigalpa', len: [8, 8] },
  '505': { iso: 'NI', tz: 'America/Managua', len: [8, 8] },
  '506': { iso: 'CR', tz: 'America/Costa_Rica', len: [8, 8] },
  '507': { iso: 'PA', tz: 'America/Panama', len: [7, 8] },
  '509': { iso: 'HT', tz: 'America/Port-au-Prince', len: [8, 8] },
  '590': { iso: 'GP', tz: 'America/Guadeloupe', len: [9, 9] },
  '591': { iso: 'BO', tz: 'America/La_Paz', len: [8, 8] },
  '592': { iso: 'GY', tz: 'America/Guyana', len: [7, 7] },
  '593': { iso: 'EC', tz: 'America/Guayaquil', len: [8, 9], mob: ['9'] },
  '595': { iso: 'PY', tz: 'America/Asuncion', len: [8, 9] },
  '597': { iso: 'SR', tz: 'America/Paramaribo', len: [6, 7] },
  '598': { iso: 'UY', tz: 'America/Montevideo', len: [8, 8] },
  '599': { iso: 'CW', tz: 'America/Curacao', len: [7, 8] },
  '670': { iso: 'TL', tz: 'Asia/Dili', len: [7, 8] },
  '673': { iso: 'BN', tz: 'Asia/Brunei', len: [7, 7] },
  '675': { iso: 'PG', tz: 'Pacific/Port_Moresby', len: [7, 8] },
  '679': { iso: 'FJ', tz: 'Pacific/Fiji', len: [7, 7] },
  '680': { iso: 'PW', tz: 'Pacific/Palau', len: [7, 7] },
  '685': { iso: 'WS', tz: 'Pacific/Apia', len: [5, 7] },
  '686': { iso: 'KI', tz: 'Pacific/Tarawa', len: [5, 8] },
  '687': { iso: 'NC', tz: 'Pacific/Noumea', len: [6, 6] },
  '689': { iso: 'PF', tz: 'Pacific/Tahiti', len: [8, 8] },
  '850': { iso: 'KP', tz: 'Asia/Pyongyang', len: [8, 10] },
  '852': { iso: 'HK', tz: 'Asia/Hong_Kong', len: [8, 8], mob: ['5', '6', '9'] },
  '853': { iso: 'MO', tz: 'Asia/Macau', len: [8, 8], mob: ['6'] },
  '855': { iso: 'KH', tz: 'Asia/Phnom_Penh', len: [8, 9], mob: ['1', '6', '7', '8', '9'] },
  '856': { iso: 'LA', tz: 'Asia/Vientiane', len: [8, 10], mob: ['20'] },
  '880': { iso: 'BD', tz: 'Asia/Dhaka', len: [8, 10], mob: ['1'] },
  '886': { iso: 'TW', tz: 'Asia/Taipei', len: [9, 9], mob: ['9'] },
  '960': { iso: 'MV', tz: 'Indian/Maldives', len: [7, 7] },
  '961': { iso: 'LB', tz: 'Asia/Beirut', len: [7, 8], mob: ['3', '7'] },
  '962': { iso: 'JO', tz: 'Asia/Amman', len: [9, 9], mob: ['7'] },
  '963': { iso: 'SY', tz: 'Asia/Damascus', len: [8, 9] },
  '964': { iso: 'IQ', tz: 'Asia/Baghdad', len: [9, 10], mob: ['7'] },
  '965': { iso: 'KW', tz: 'Asia/Kuwait', len: [8, 8], mob: ['5', '6', '9'] },
  '966': { iso: 'SA', tz: 'Asia/Riyadh', len: [9, 9], mob: ['5'] },
  '967': { iso: 'YE', tz: 'Asia/Aden', len: [9, 9] },
  '968': { iso: 'OM', tz: 'Asia/Muscat', len: [8, 8], mob: ['7', '9'] },
  '971': { iso: 'AE', tz: 'Asia/Dubai', len: [9, 9], mob: ['5'] },
  '972': { iso: 'IL', tz: 'Asia/Jerusalem', len: [8, 9], mob: ['5'] },
  '973': { iso: 'BH', tz: 'Asia/Bahrain', len: [8, 8] },
  '974': { iso: 'QA', tz: 'Asia/Qatar', len: [8, 8], mob: ['3', '5', '6', '7'] },
  '975': { iso: 'BT', tz: 'Asia/Thimphu', len: [8, 8] },
  '976': { iso: 'MN', tz: 'Asia/Ulaanbaatar', len: [8, 8] },
  '977': { iso: 'NP', tz: 'Asia/Kathmandu', len: [10, 10], mob: ['9'] },
  '992': { iso: 'TJ', tz: 'Asia/Dushanbe', len: [9, 9] },
  '993': { iso: 'TM', tz: 'Asia/Ashgabat', len: [8, 8] },
  '994': { iso: 'AZ', tz: 'Asia/Baku', len: [9, 9], mob: ['4', '5', '6', '7'] },
  '995': { iso: 'GE', tz: 'Asia/Tbilisi', len: [9, 9], mob: ['5', '7'] },
  '996': { iso: 'KG', tz: 'Asia/Bishkek', len: [9, 9], mob: ['5', '7', '9'] },
  '998': { iso: 'UZ', tz: 'Asia/Tashkent', len: [9, 9], mob: ['9', '88', '33'] },
};

/* ── Indonesia: kode area fixe ────────────────────────────────────────── */

/**
 * Kode area telpon tetap Indonesia -> kota/kabupaten + provinsi + koordinat.
 *
 * CATATAN TINGGI AKURASI: daftar ini HANYA berlaku untuk nomor landline
 * (kode awalan 2/3/4/5/6/7). Nomor seluler (awalan 8) TIDAK memuat kota —
 * alokasi seluler tidak punya area code, jadi tidak ada cara sah untuk
 * memetakan nomor seluler ke kota hanya dari prefixnya.
 */
const ID_AREA_CODES = {
  '21':  { city: 'Jakarta', province: 'DKI Jakarta', lat: -6.2088, lon: 106.8456, tz: 'Asia/Jakarta' },
  '22':  { city: 'Bandung', province: 'Jawa Barat', lat: -6.9175, lon: 107.6191, tz: 'Asia/Jakarta' },
  '23':  { city: 'Semarang', province: 'Jawa Tengah', lat: -6.9667, lon: 110.4167, tz: 'Asia/Jakarta' },
  '24':  { city: 'Surabaya', province: 'Jawa Timur', lat: -7.2575, lon: 112.7521, tz: 'Asia/Jakarta' },
  '25':  { city: 'Bogor / Depok / Bekasi', province: 'Jawa Barat', lat: -6.5950, lon: 106.8166, tz: 'Asia/Jakarta' },
  '26':  { city: 'Cimahi / Bandung Raya', province: 'Jawa Barat', lat: -6.8741, lon: 107.6010, tz: 'Asia/Jakarta' },
  '27':  { city: 'Surakarta (Solo)', province: 'Jawa Tengah', lat: -7.5755, lon: 110.8243, tz: 'Asia/Jakarta' },
  '28':  { city: 'Wonosobo', province: 'Jawa Tengah', lat: -7.2958, lon: 110.3714, tz: 'Asia/Jakarta' },
  '29':  { city: 'Magelang', province: 'Jawa Tengah', lat: -7.4698, lon: 110.2177, tz: 'Asia/Jakarta' },
  '31':  { city: 'Sidoarjo / Surabaya Raya', province: 'Jawa Timur', lat: -7.3765, lon: 112.7863, tz: 'Asia/Jakarta' },
  '32':  { city: 'Mojokerto', province: 'Jawa Timur', lat: -7.3833, lon: 112.5000, tz: 'Asia/Jakarta' },
  '33':  { city: 'Bojonegoro', province: 'Jawa Timur', lat: -7.1500, lon: 111.9817, tz: 'Asia/Jakarta' },
  '34':  { city: 'Malang', province: 'Jawa Timur', lat: -7.9666, lon: 112.6326, tz: 'Asia/Jakarta' },
  '35':  { city: 'Lamongan', province: 'Jawa Timur', lat: -7.1226, lon: 112.4194, tz: 'Asia/Jakarta' },
  '36':  { city: 'Kediri', province: 'Jawa Timur', lat: -7.8419, lon: 112.7269, tz: 'Asia/Jakarta' },
  '37':  { city: 'Purbalingga', province: 'Jawa Tengah', lat: -7.3917, lon: 109.1836, tz: 'Asia/Jakarta' },
  '41':  { city: 'Ternate', province: 'Maluku Utara', lat: 0.7893, lon: 127.3800, tz: 'Asia/Jayapura' },
  '42':  { city: 'Ternate', province: 'Maluku Utara', lat: 0.7893, lon: 127.3800, tz: 'Asia/Jayapura' },
  '43':  { city: 'Kotamobagu', province: 'Sulawesi Utara', lat: 1.4700, lon: 124.8426, tz: 'Asia/Makassar' },
  '44':  { city: 'Manado', province: 'Sulawesi Utara', lat: 1.4748, lon: 124.8421, tz: 'Asia/Makassar' },
  '45':  { city: 'Ambon', province: 'Maluku', lat: -3.6950, lon: 128.1814, tz: 'Asia/Jayapura' },
  '46':  { city: 'Ambon', province: 'Maluku', lat: -3.6950, lon: 128.1814, tz: 'Asia/Jayapura' },
  '47':  { city: 'Ternate', province: 'Maluku Utara', lat: 0.7893, lon: 127.3800, tz: 'Asia/Jayapura' },
  '48':  { city: 'Ambon', province: 'Maluku', lat: -3.6950, lon: 128.1814, tz: 'Asia/Jayapura' },
  '51':  { city: 'Banda Aceh', province: 'Aceh', lat: 5.5483, lon: 95.3238, tz: 'Asia/Jakarta' },
  '52':  { city: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '53':  { city: 'Sibolga', province: 'Sumatera Utara', lat: 0.9274, lon: 98.6270, tz: 'Asia/Jakarta' },
  '54':  { city: 'Pematangsiantar', province: 'Sumatera Utara', lat: 2.9730, lon: 99.7700, tz: 'Asia/Jakarta' },
  '55':  { city: 'Pematang Siantar', province: 'Sumatera Utara', lat: 2.9730, lon: 99.7700, tz: 'Asia/Jakarta' },
  '56':  { city: 'Kisaran', province: 'Sumatera Utara', lat: 2.9917, lon: 99.8550, tz: 'Asia/Jakarta' },
  '57':  { city: 'Rantauprapat', province: 'Sumatera Utara', lat: 2.1244, lon: 99.7000, tz: 'Asia/Jakarta' },
  '61':  { city: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '62':  { city: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '63':  { city: 'Aceh / Lhokseumawe', province: 'Aceh', lat: 5.1800, lon: 97.1400, tz: 'Asia/Jakarta' },
  '64':  { city: 'Langsa / Lhokseumawe', province: 'Aceh', lat: 5.1800, lon: 97.1400, tz: 'Asia/Jakarta' },
  '65':  { city: 'Lhokseumawe', province: 'Aceh', lat: 5.1800, lon: 97.1400, tz: 'Asia/Jakarta' },
  '66':  { city: 'Meulaboh', province: 'Aceh', lat: 4.5700, lon: 96.1300, tz: 'Asia/Jakarta' },
  '67':  { city: 'Meulaboh / Sigli', province: 'Aceh', lat: 4.5700, lon: 96.1300, tz: 'Asia/Jakarta' },
  '68':  { city: 'Meulaboh', province: 'Aceh', lat: 4.5700, lon: 96.1300, tz: 'Asia/Jakarta' },
  '69':  { city: 'Meulaboh', province: 'Aceh', lat: 4.5700, lon: 96.1300, tz: 'Asia/Jakarta' },
  '71':  { city: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '72':  { city: 'Medan / Pematang Siantar', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '73':  { city: 'Bandar Lampung', province: 'Lampung', lat: -5.4292, lon: 105.2610, tz: 'Asia/Jakarta' },
  '74':  { city: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lon: 98.6722, tz: 'Asia/Jakarta' },
  '75':  { city: 'Binjai', province: 'Sumatera Utara', lat: 3.6060, lon: 98.4600, tz: 'Asia/Jakarta' },
  '76':  { city: 'Padang Sidempuan', province: 'Sumatera Utara', lat: 3.5730, lon: 99.1230, tz: 'Asia/Jakarta' },
  '77':  { city: 'Padang', province: 'Sumatera Barat', lat: -0.9471, lon: 100.4172, tz: 'Asia/Jakarta' },
  '78':  { city: 'Padang / Pariaman', province: 'Sumatera Barat', lat: -0.9471, lon: 100.4172, tz: 'Asia/Jakarta' },
  '79':  { city: 'Rengat / Pekanbaru', province: 'Riau', lat: 0.5071, lon: 101.4478, tz: 'Asia/Jakarta' },
};

/**
 * Perkiraan zona waktu Indonesia untuk nomor SELULER.
 *
 * Alokasi seluler tidak memuat area code, jadi zona waktu pun tidak resmi.
 * Prefix di bawah dipakai sebagai PETA KASAR dan hanya untuk blok prefix
 * yang alokasinya regional (0811/0824/0854 → Papua, 0814/0821-0829/0831-0838/
 * 0853/0871-0876 → Sulawesi-Bali-Kalimantan).
 *
 * Prefix yang DITERBITKAN NASIONAL (0812, 0813, 0815-0819, 0857-0859,
 * 0877-0879, dst.) SENGAJA TIDAK dipetakan. Operator besar menerbitkan blok
 * ini di seluruh Indonesia, jadi memetakannya ke satu wilayah tertentu hanya
 * akan menampilkan zona waktu yang kemungkinan besar salah — lebih jujur
 * memakai zona bawaan dengan label "nilai bawaan".
 *
 * PENTING: pola di bawah dicocokkan ke NSN TANPA awalan "0"
 * (mis. "81234567890"), karena itu bentuk yang dipakai modul phone-info.
 */
const ID_MOBILE_TZ = [
  // Papua & Maluku (WIT, UTC+9)
  { re: /^811\d/, tz: 'Asia/Jayapura' },
  { re: /^824\d/, tz: 'Asia/Jayapura' },
  { re: /^854\d/, tz: 'Asia/Jayapura' },

  // Sulawesi, Bali, Nusa Tenggara, Kalimantan (WITA, UTC+8)
  { re: /^814\d/, tz: 'Asia/Makassar' },
  { re: /^82[125-9]\d/, tz: 'Asia/Makassar' },
  { re: /^83[12]\d/, tz: 'Asia/Makassar' },
  { re: /^838\d/, tz: 'Asia/Makassar' },
  { re: /^853\d/, tz: 'Asia/Makassar' },
  { re: /^87[1-6]\d/, tz: 'Asia/Makassar' },
];

/* ── Fungsi lookup ────────────────────────────────────────────────────── */

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['id'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** Nama negara dalam bahasa Indonesia (fallback ke ISO code). */
export function countryName(iso) {
  if (!iso) return null;
  try {
    return displayNames?.of(iso) || iso;
  } catch {
    return iso;
  }
}

/**
 * Pisahkan kode negara dari digit nomor.
 * Kode negara 1-3 digit; yang cocok selalu yang paling awal.
 */
export function splitCallingCode(digits) {
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (COUNTRY_META[cc]) return { cc, nsn: digits.slice(len) };
  }
  return null;
}

/** Metadata negara berdasarkan kode negara (tanpa '+'). */
export function countryByCode(cc) {
  const m = COUNTRY_META[String(cc || '').replace(/\D/g, '')];
  if (!m) return null;
  return { cc: String(cc), iso: m.iso, country: countryName(m.iso), timezone: m.tz, len: m.len, ...m };
}

/**
 * Analisis satu nomor E.164 terhadap tabel metadata.
 *
 * @param {string} e164 - mis. "+6281234567890"
 * @returns {object|null} hasil analisis, null bila kode negara tidak dikenal
 */
export function analyzeNumber(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  if (!digits) return null;

  const split = splitCallingCode(digits);
  if (!split) return null;

  const meta = countryByCode(split.cc);
  if (!meta) return null;

  const nsn = split.nsn;
  const [minLen, maxLen] = meta.len;

  // "Possible" = panjang masuk rentang yang mungkin dipakai negara itu.
  // libphonenumber memakai definisi yang sama: hanya panjang, tanpa awalan.
  const possible = nsn.length >= minLen && nsn.length <= maxLen;

  // "Valid" = possible DAN cocok dengan pola awalan yang diketahui.
  let type = 'unknown';
  if (meta.nanp) {
    // NANP: 10 digit, tidak bisa dibedakan seluler/tetap tanpa area code.
    type = nsn.length === 10 ? 'mobile_or_fixed' : 'unknown';
  } else if (meta.toll?.some((p) => nsn.startsWith(p.replace(/^0/, '')))) {
    type = 'toll_free';
  } else if (meta.mob?.some((p) => nsn.startsWith(p))) {
    type = 'mobile';
  } else if (meta.fix?.some((p) => nsn.startsWith(p))) {
    type = 'fixed';
  } else if (nsn.startsWith('900') || nsn.startsWith('1900')) {
    type = 'premium';
  } else if (meta.mob) {
    // Negara ini punya daftar awalan seluler, tapi nomor ini tidak cocok
    // dengan salah satunya. Kemungkinan besar garis tetap, tapi tabel lokal
    // tidak punya daftar awalan garis tetap, jadi tipenya sengaja tidak
    // diklaim pasti.
    type = 'fixed_or_unknown';
  }

  // "valid" hanya diberikan kalau tipenya benar-benar teridentifikasi.
  // "fixed_or_unknown" sengaja TIDAK dihitung valid — bukti cukup untuk
  // "possible", belum cukup untuk "valid".
  const valid = possible && ['mobile', 'fixed', 'toll_free'].includes(type);

  return {
    cc: meta.cc,
    iso: meta.iso,
    country: meta.country,
    timezone: meta.tz,
    nsn,
    nsnLength: nsn.length,
    possible,
    valid,
    type,
    nanp: !!meta.nanp,
    nationalLengthRange: [minLen, maxLen],
  };
}

/* ── Indonesia: area & zona waktu ─────────────────────────────────────── */

/**
 * Tebakan area pendaftaran untuk nomor Indonesia.
 *
 * - Landline (awalan 2/3/4/5/6/7): kode area -> kota + koordinat.
 * - Seluler (awalan 8): TIDAK ada kota; hanya zona waktu kasar + operator.
 *
 * @returns {{area: object|null, zone: string, zoneConfidence: string, kind: string}}
 */
export function indonesiaArea(digits62) {
  // digits62 = nomor nasional tanpa awalan 0 (mis. "81234567890").
  if (!digits62) return { area: null, zone: 'Asia/Jakarta', zoneConfidence: 'unknown', kind: 'unknown' };

  const nsn = digits62;
  const zoneHit = ID_MOBILE_TZ.find((r) => r.re.test(nsn));

  if (nsn.startsWith('8')) {
    return {
      area: null,
      zone: zoneHit?.tz || 'Asia/Jakarta',
      zoneConfidence: zoneHit ? 'low' : 'default',
      kind: 'mobile',
    };
  }

  // Landline: kode area 2-3 digit (kode 2 digit selalu lebih dulu).
  const area =
    (ID_AREA_CODES[nsn.slice(0, 2)] ? { code: nsn.slice(0, 2) } : null) ||
    (ID_AREA_CODES[nsn.slice(0, 3)] ? { code: nsn.slice(0, 3) } : null);

  if (area) {
    const a = ID_AREA_CODES[area.code];
    return {
      area: { code: area.code, city: a.city, province: a.province, lat: a.lat, lon: a.lon },
      zone: a.tz,
      zoneConfidence: 'high',
      kind: 'fixed',
    };
  }

  return { area: null, zone: zoneHit?.tz || 'Asia/Jakarta', zoneConfidence: 'low', kind: 'fixed' };
}

/**
 * Waktu lokal saat ini di zona waktu tertentu.
 * Mengembalikan null kalau zona waktu tidak dikenal oleh runtime.
 */
export function localTimeIn(timeZone, now = new Date()) {
  if (!timeZone) return null;
  try {
    const fmt = new Intl.DateTimeFormat('id-ID', {
      timeZone,
      dateStyle: 'full',
      timeStyle: 'medium',
    });
    return fmt.format(now);
  } catch {
    return null;
  }
}

/** Offset zona waktu dalam jam dari UTC (mis. +7 untuk WIB). */
export function utcOffsetHours(timeZone, now = new Date()) {
  if (!timeZone) return null;
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = s?.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    return Number(m[1]) + Number(m[2] || 0) / 60;
  } catch {
    return null;
  }
}

/**
 * Format nomor untuk tampilan.
 * Indonesia: 0812-3456-7890 (seluler) atau 021-1234567 (landline, kalau
 * kode areanya diketahui). Negara lain: national significant number
 * dengan spasi pemisah kelompok (best effort).
 *
 * @param {string} cc  - kode negara tanpa '+'
 * @param {string} nsn - national significant number tanpa kode negara
 * @param {string} [areaCode] - kode area untuk negara Indonesia (landline)
 */
export function formatNational(cc, nsn, areaCode) {
  if (cc === '62') {
    // Landline: kode area dipisah, sisa nomor dikelompokkan.
    if (areaCode && nsn.startsWith(areaCode)) {
      const rest = nsn.slice(areaCode.length);
      if (!rest) return `0${areaCode}`;
      if (rest.length <= 7) return `0${areaCode}-${rest.slice(0, 3)}-${rest.slice(3)}`;
      return `0${areaCode}-${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    // Seluler: 08xx-xxxx-xxxx
    return `0${nsn.slice(0, 3)}-${nsn.slice(3, 7)}-${nsn.slice(7)}`.slice(0, 16);
  }
  if (cc === '1' && nsn.length === 10) {
    return `(${nsn.slice(0, 3)}) ${nsn.slice(3, 6)}-${nsn.slice(6)}`;
  }
  if (nsn.length <= 6) return nsn;
  // Kelompokkan 3-3-4 (atau 4-3-3) supaya mudah dibaca.
  const head = nsn.length % 3 === 1 ? 4 : 3;
  const groups = [nsn.slice(0, head)];
  let rest = nsn.slice(head);
  while (rest.length) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  return groups.join(' ');
}
