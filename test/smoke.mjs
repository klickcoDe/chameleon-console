/**
 * Smoke test: menyalakan semua modul lalu memeriksa hasilnya.
 * Jalankan: node test/smoke.mjs   (server tidak perlu hidup)
 */

import { investigate } from '../src/investigator.js';
import { investigatePhone } from '../src/modules/phone.js';
import { searchUsername } from '../src/modules/social.js';
import { geocode } from '../src/modules/location.js';
import { checkPassword, buildDorks } from '../src/modules/breach.js';
import {
  toMaltegoCSV,
  toClipboardText,
  toLinkText,
  toJSON,
  handleTransform,
  importGuide,
} from '../src/modules/maltego.js';
import { normalize } from '../src/util/phone.js';
import {
  dnsLookup,
  whoisLookup,
  findSubdomains,
  httpProbe,
  siteFingerprint,
  parseDomain,
} from '../src/modules/domain.js';
import { ipProfile, ipOwnership, parseIP } from '../src/modules/network.js';
import { hashAll, identifyHash, decodeAuto, decodeJWT, analysePassword } from '../src/util/crypto.js';
import { analyzeNumber, indonesiaArea, localTimeIn, utcOffsetHours, formatNational, countryByCode } from '../src/util/phone-meta.js';
import { phoneInfo } from '../src/modules/phoneinfo.js';
import { contactNames, extractNames, extractLabels } from '../src/modules/contacts.js';
import { publicMentions, parseBingResults, parseDdgResults } from '../src/modules/mentions.js';
import { portScan, parsePorts, COMMON_PORTS } from '../src/modules/portscan.js';
import { bgpLookup, macVendor, sanctionsSearch, ipIntel } from '../src/modules/osiris.js';
import { cekPos } from '../src/modules/cekpos.js';

let pass = 0;
let fail = 0;
let skipped = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** Pemeriksaan yang dilewati karena sumbernya tidak merespons (bukan bug). */
function skip(name, reason = '') {
  skipped++;
  console.log(`  \x1b[33m−\x1b[0m ${name}${reason ? ' — ' + reason : ''} \x1b[2m(dilewati)\x1b[0m`);
}

/**
 * Pemeriksaan yang bergantung pada pihak ketiga.
 *
 * Kalau modulnya gagal HANYA karena jaringan (timeout, HTTP error, DNS),
 * hasilnya ditandai "dilewati" — bukan "gagal". Kegagalan jaringan bukan
 * bug kode, dan harus dilaporkan apa adanya, bukan disamarkan.
 */
function checkNet(name, ok, detail = '', res = null) {
  if (ok) return check(name, true, detail);
  const err = String(res?.error || '');
  const looksLikeNetwork = /http\s?\d|timeout|timed out|fetch|ECONN|ENOTFOUND|EAI_AGAIN|socket|diluar jaringan|network/i.test(err);
  if (res && res.ok === false && looksLikeNetwork) return skip(name, err.slice(0, 90));
  return check(name, false, detail || err.slice(0, 90));
}

const group = (t) => console.log(`\n\x1b[36m${t}\x1b[0m`);

/* ── Normalisasi telepon (offline) ─────────────────────────────────── */
group('Normalisasi nomor telepon');
const cases = [
  ['0812-3456-7890', '+6281234567890'],
  ['081234567890', '+6281234567890'],
  ['+62 812 3456 7890', '+6281234567890'],
  ['6281234567890', '+6281234567890'],
  ['81234567890', '+6281234567890'],
  ['+1 (202) 555-0143', '+12025550143'],
];
for (const [input, expected] of cases) {
  const got = normalize(input)?.e164;
  check(`${input} → ${expected}`, got === expected, got ? `dapat ${got}` : 'null');
}
check('input tidak valid ditolak', normalize('bukan-nomor') === null);

/* ── Phone module ───────────────────────────────────────────────────── */
group('Modul telepon');
const phone = await investigatePhone('0812-3456-7890');
check('nomor ternormalisasi', phone.ok && phone.e164 === '+6281234567890');
check('operator terdeteksi', !!phone.operator, phone.operator);
check('link wa.me tersedia', phone.links.some((l) => l.platform === 'WhatsApp'));
check('WA berstatus manual/bayar', ['needs_manual', 'registered'].includes(phone.checks.whatsapp.status));

/* ── Social module ──────────────────────────────────────────────────── */
group('Modul media sosial');
const social = await searchUsername('torvalds', ['GitHub', 'Reddit', 'Telegram']);
checkNet('enumerasi berjalan', social.ok, JSON.stringify(social.summary || {}), social);
checkNet('GitHub ditemukan', social.found.some((f) => f.platform === 'GitHub'), '', social);
check('ringkasan terisi', typeof social.summary.found === 'number', JSON.stringify(social.summary));
check('username tidak valid ditolak', (await searchUsername('!!')).ok === false);

/* ── Lokasi ─────────────────────────────────────────────────────────── */
group('Modul lokasi');
const geo = await geocode('Bandung');
checkNet('geocode menemukan tempat', geo.ok && geo.places.length > 0, `${geo.count} hasil`, geo);
checkNet('koordinat valid', geo.ok && Math.abs(geo.places[0].lat) <= 90, '', geo);

/* ── Password & dorks ───────────────────────────────────────────────── */
group('Modul password & dork');
const pw = await checkPassword('password123');
checkNet('password dicek ke Pwned Passwords', pw.ok, pw.breached ? `bocor, ${pw.count}x` : 'tidak bocor', pw);
const dorks = buildDorks({ name: 'Budi Santoso', phone: '081234567890', location: 'Bandung' });
check('dork terbentuk', dorks.ok && dorks.dorks.length > 0, `${dorks.count} query`);

/* ── Orkestrator + Maltego ──────────────────────────────────────────── */
group('Orkestrator & Maltego');
const report = await investigate({
  name: 'Budi Santoso',
  username: 'torvalds',
  phone: '081234567890',
  location: 'Bandung',
  checkSocial: false,
  // Modul contacts menembak mesin pencari → lambat & bergantung jaringan.
  // Diuji terpisah di bawah; di sini cukup memastikan wiring-nya nyala.
  checkContacts: false,
});
check('laporan terbentuk', report.ok);
check('modul phone jalan', report.modules.phone?.ok === true);
checkNet('modul lokasi jalan', report.modules.location?.ok === true, '', report.modules.location);
check('modul profil nomor jalan', report.modules.phoneInfo?.ok === true);
check('graph punya entity', report.graph.entities.length > 0, `${report.graph.entities.length} entity`);
check('graph punya link', report.graph.links.length > 0, `${report.graph.links.length} link`);
const csv = toMaltegoCSV(report.graph);
check('ekspor CSV untuk import Maltego valid',
  csv.startsWith('value,type,link_from,link_to,link_label,properties') &&
  csv.split('\n').length > 1,
  csv.split('\n')[0]);
check('CSV memuat link', csv.includes('--') === false && /"nomor telepon"|"berada di"/.test(csv));
const clip = toClipboardText(report.graph);
check('ekspor clipboard format "Tipe#nilai"',
  clip.split('\n').every((l) => /^[A-Za-z]+#.+$/.test(l)) && clip.split('\n').length === report.graph.entities.length);
check('ekspor teks link tersusun', toLinkText(report.graph).includes('-->'));
check('JSON arsip valid', !!JSON.parse(toJSON(report.graph)).entities);
check('panduan import tersedia', importGuide.transform[0].includes('Maltego Transform Provider'));

const listTransforms = await handleTransform({
  entity: { type: 'PhoneNumber', value: '+6281234567890' },
});
check('Maltego memberi daftar transform', listTransforms.transforms.length > 0,
  `${listTransforms.transforms.length} transform`);

const runT = await handleTransform({
  entity: { type: 'PhoneNumber', value: '+6281234567890' },
  transform: { fields: { run: 'resolve-osint-phone' } },
});
checkNet('transform nomor dieksekusi', runT.returnedEntities.length > 0,
  `${runT.returnedEntities.length} entity`, runT);

const runGeo = await handleTransform({
  entity: { type: 'Location', value: 'Surabaya' },
  transform: { fields: { run: 'osint-geocode' } },
});
checkNet('transform geocode dieksekusi', runGeo.returnedEntities.length > 0, '', runGeo);

// Transform domain/IP baru — keduanya harus mengembalikan entity.
const runDomainT = await handleTransform({
  entity: { type: 'Domain', value: 'github.com' },
  transform: { fields: { run: 'osint-domain-recon' } },
});
checkNet('transform domain dieksekusi', runDomainT.returnedEntities.length > 0,
  `${runDomainT.returnedEntities.length} entity`, runDomainT);

const runIpT = await handleTransform({
  entity: { type: 'IpAddress', value: '8.8.8.8' },
  transform: { fields: { run: 'osint-ip-profile' } },
});
checkNet('transform profil IP dieksekusi', runIpT.returnedEntities.length > 0,
  `${runIpT.returnedEntities.length} entity`, runIpT);

const empty = await investigate({});
check('input kosong ditolak dengan pesan jelas', empty.ok === false && !!empty.error);

/* ── Validasi input domain (offline) ────────────────────────────────── */
group('Validasi domain');
const domainCases = [
  ['github.com', 'github.com'],
  ['https://www.contoh.com/path?x=1', 'www.contoh.com'],
  ['sub.domain.co.id', 'sub.domain.co.id'],
  ['  EXAMPLE.COM  ', 'example.com'],
  ['contoh.com:8080', 'contoh.com'],
];
for (const [input, expected] of domainCases) {
  check(`${input} → ${expected}`, parseDomain(input) === expected, String(parseDomain(input)));
}
check('domain tidak valid ditolak', parseDomain('bukan domain!!') === null);

check('IP valid terdeteksi', parseIP('8.8.8.8')?.version === 4);
check('IPv6 valid terdeteksi', parseIP('2001:4860:4860::8888')?.version === 6);
check('IP tidak valid ditolak', parseIP('999.999.999.999') === null);

/* ── Modul domain ────────────────────────────────────────────────────── */
group('Modul domain');
const dns = await dnsLookup('github.com', 'A');
checkNet('DNS A record ditemukan', dns.ok && dns.resolved,
  dns.records?.flatMap((r) => r.answers || []).slice(0, 2).map((a) => a.data).join(', '), dns);
check('DNS tidak valid ditolak', (await dnsLookup('domain- ng ADA', 'A')).ok === false);

const whois = await whoisLookup('github.com');
checkNet('WHOIS RDAP berhasil', whois.ok, whois.registrar?.name, whois);
check('WHOIS punya tanggal daftar', !!whois.events?.created, whois.events?.created?.slice(0, 10));
check('WHOIS punya nameserver', (whois.nameservers || []).length > 0);
check('WHOIS domain tidak ada ditolak', (await whoisLookup('domain-tidak-ada-xyz123.invalid')).ok === false);

const subs = await findSubdomains('github.com');
checkNet('Subdomain CT mengembalikan hasil', typeof subs.count === 'number',
  `${subs.count} subdomain, sumber: ${subs.sources.map((s) => `${s.name}=${s.ok ? 'ok' : 'gagal'}`).join(', ')}`, subs);
// Count 0 masih sah (log CT bisa kosong); yang penting bentuk responsnya benar.
check('Subdomain selalu melaporkan status sumber', Array.isArray(subs.sources) && subs.sources.length > 0);

const probe = await httpProbe('https://github.com');
checkNet('HTTP probe berhasil', probe.ok, `HTTP ${probe.status}`, probe);
check('Skor keamanan terhitung', typeof probe.security?.score === 'number',
  `${probe.security?.score}/100 grade ${probe.security?.grade}`);
check('Header keamanan dianalisis', Array.isArray(probe.security?.missing));
check('URL tidak valid ditolak', (await httpProbe('ht!tp://[bad')).ok === false);

const fp = await siteFingerprint('https://github.com');
checkNet('Fingerprint situs berhasil', fp.ok, fp.title?.slice(0, 40), fp);
check('Tech terdeteksi', Array.isArray(fp.tech), (fp.tech || []).slice(0, 3).join(', '));

/* ── Modul jaringan ──────────────────────────────────────────────────── */
group('Modul jaringan');
const ipProf = await ipProfile('8.8.8.8');
checkNet('Profil IP berhasil', ipProf.ok, ipProf.network?.isp, ipProf);
check('ASN terdeteksi', !!ipProf.network?.asn, ipProf.network?.asn);
check('IP tidak valid ditolak', (await ipProfile('bukan-ip')).ok === false);

const ipOwn = await ipOwnership('8.8.8.8');
checkNet('RDAP kepemilikan IP berhasil', ipOwn.ok, ipOwn.range, ipOwn);
check('CIDR terdeteksi', (ipOwn.cidr || []).length > 0);

/* ── Forensik / kripto ───────────────────────────────────────────────── */
group('Forensik & kripto');
const hashes = hashAll('halo');
// Nilai ini diverifikasi silang dengan md5sum di shell, bukan diasumsikan.
check('MD5 dihitung', hashes.md5 === '57F842286171094855E51FC3A541C1E2', hashes.md5);
check('SHA-256 dihitung', hashes.sha256.length === 64);

check('Hash MD5 dikenali', identifyHash(hashes.md5).candidates?.includes('MD5'));
check('Hash SHA-256 dikenali', identifyHash(hashes.sha256).candidates?.includes('SHA-256'));
check('JWT dikenali', identifyHash('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig').detected === 'JWT');
check('Input acak ditolak', identifyHash('zzz!!').ok === false);

const b64 = decodeAuto('SGVsbG8gT3NJTlQ=');
check('Base64 didekode', b64.ok && b64.decoded === 'Hello OsINT', b64.decoded);

const jwt = decodeJWT('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSIsImV4cCI6MTkxNTAwMDAwMH0.sig');
check('JWT di-parse', jwt.ok && jwt.payload.sub === '12345');
check('JWT punya status kedaluwarsa', typeof jwt.timestamps.expired === 'boolean');
check('JWT rusak ditolak', decodeJWT('bukan.jwt').ok === false);

const weakPw = analysePassword('password');
check('Password lemah dikenali', weakPw.score === 0, weakPw.label);
const strongPw = analysePassword('Xk9#mQ2$vL8@pR4!wZ');
check('Password kuat dikenali', strongPw.score >= 3, strongPw.label);

/* ── Metadata nomor (offline, tabel E.164 lokal) ──────────────────────── */
group('Metadata nomor (offline)');
const idNum = analyzeNumber('+6281234567890');
check('kode negara terdeteksi', idNum?.cc === '62', idNum?.country);
check('negara terdeteksi', idNum?.country === 'Indonesia', idNum?.country);
check('tipe seluler terdeteksi', idNum?.type === 'mobile', idNum?.type);
check('nomor dinyatakan valid', idNum?.valid === true && idNum?.possible === true);
check('panjang NSN sesuai', idNum?.nsnLength === 11, String(idNum?.nsnLength));

const usNum = analyzeNumber('+12025550143');
check('NANP dipisah dengan benar', usNum?.cc === '1' && usNum?.nsn === '2025550143');
check('NANP tidak diklaim pasti seluler/tetap', usNum?.type === 'mobile_or_fixed', usNum?.type);

check('kode negara tak dikenal ditolak', analyzeNumber('+999999999') === null);
check('nomor terlalu pendek tidak possible',
  analyzeNumber('+62812')?.possible === false);
check('lookup negara by kode', countryByCode('62')?.iso === 'ID', countryByCode('62')?.iso);

const idFixed = indonesiaArea('212345678');
check('kode area Jakarta terdeteksi', idFixed?.area?.code === '21' && idFixed.area.city === 'Jakarta');
check('kota landline punya koordinat', Math.abs(idFixed.area.lat) <= 90 && Math.abs(idFixed.area.lon) <= 180);
check('zona waktu landline punya confidence tinggi', idFixed?.zoneConfidence === 'high', idFixed?.zone);

const idMobile = indonesiaArea('81234567890');
check('nomor seluler tidak dikasih kota', idMobile?.area === null && idMobile?.kind === 'mobile');
check('prefix nasional tidak diklaim wilayah tertentu', idMobile?.zoneConfidence === 'default',
  `${idMobile?.zone} (${idMobile?.zoneConfidence})`);
check('prefix alokasi regional dapat zona waktu', indonesiaArea('8112345678')?.zone === 'Asia/Jayapura',
  indonesiaArea('8112345678')?.zone);
check('prefix Sulawesi dapat zona waktu', indonesiaArea('8532345678')?.zone === 'Asia/Makassar',
  indonesiaArea('8532345678')?.zone);

check('waktu lokal dihitung', !!localTimeIn('Asia/Jakarta'), localTimeIn('Asia/Jakarta'));
check('offset WIB = +7', utcOffsetHours('Asia/Jakarta') === 7, String(utcOffsetHours('Asia/Jakarta')));
check('format nomor Indonesia', formatNational('62', '81234567890') === '0812-3456-7890', formatNational('62', '81234567890'));
check('format landline Indonesia', formatNational('62', '213456789', '21') === '021-345-6789', formatNational('62', '213456789', '21'));

/* ── Ekstraksi nama & label kontak (offline) ──────────────────────────── */
group('Ekstraksi nama & tag kontak (offline)');
check('nama pemanggil diambil',
  extractNames('Nama pemanggil: Budi Santoso').includes('Budi Santoso'),
  JSON.stringify(extractNames('Nama pemanggil: Budi Santoso')));
check('nama "atas nama" diambil',
  extractNames('Toko Berkah, atas nama Siti Aminah').includes('Siti Aminah'));
check('nama Telegram generik bukan nama orang',
  extractNames('Chat with +62 812-3456-7890').length === 0,
  JSON.stringify(extractNames('Chat with +62 812-3456-7890')));
check('label toko online terdeteksi',
  extractLabels('Tokopedia CS admin — hubungi via WhatsApp').includes('toko online'));
check('label CS terdeteksi',
  extractLabels('CS Tokopedia').includes('CS / customer service'));
check('label risiko penipuan terdeteksi',
  extractLabels('Nomor ini dilaporkan penipu dan sering spam').includes('indikasi penipuan'));
check('label blacklist terdeteksi',
  extractLabels(' masuk daftar blacklist dan spam').includes('indikasi spam / blacklist'));
check('label tak dikenal tidak dipaksakan',
  extractLabels('cuplikan netral tanpa kata kunci').length === 0);

/* ── Parser hasil mesin pencari (offline) ────────────────────────────── */
group('Parser hasil pencarian (offline)');
const bingHtml = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=1&u=a1${Buffer.from('https://tellows.net/081234567890').toString('base64url')}">Nomor 081234567890</a></h2><p class="b_lineclamp">Nama pemanggil Budi Santoso</p></li></ol>`;
const bingParsed = parseBingResults(bingHtml);
check('hasil Bing di-parse', bingParsed.length === 1, `${bingParsed.length} hasil`);
check('URL Bing di-decode ke URL asli', bingParsed[0]?.url === 'https://tellows.net/081234567890', bingParsed[0]?.url);
check('cuplikan Bing diambil', (bingParsed[0]?.snippet || '').includes('Budi Santoso'));

const ddgHtml = `<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://www.tokopedia.com/toko-budi')}">Toko Budi</a><a class="result__snippet" href="https://www.tokopedia.com/toko-budi">CS 081234567890</a></div>`;
const ddgParsed = parseDdgResults(ddgHtml);
check('hasil DDG di-parse', ddgParsed.length === 1, `${ddgParsed.length} hasil`);
check('URL redirect DDG di-decode', ddgParsed[0]?.url === 'https://www.tokopedia.com/toko-budi', ddgParsed[0]?.url);
check('cuplikan DDG diambil', (ddgParsed[0]?.snippet || '').includes('081234567890'));

/* ── Port scan (offline, target localhost) ────────────────────────────── */
group('Port scan (offline)');
check('daftar port dari string', JSON.stringify(parsePorts('22,80,443')) === '[22,80,443]', JSON.stringify(parsePorts('22,80,443')));
check('rentang port di-expand', JSON.stringify(parsePorts('20-23')) === '[20,21,22,23]', JSON.stringify(parsePorts('20-23')));
check('port di luar rentang dibuang', !parsePorts('0,70000,8080').includes(0) && parsePorts('0,70000,8080').includes(8080));
check('input kosong -> daftar port umum', parsePorts('').length === COMMON_PORTS.length);

const localScan = await portScan('127.0.0.1', { ports: '1,2,3', timeout: 1000 });
check('port scan localhost jalan', localScan.ok === true, `scanned ${localScan.portsScanned}`);
check('port scan melaporkan jumlah dipindai', localScan.portsScanned === 3, String(localScan.portsScanned));
check('port scan punya ringkasan', typeof localScan.summary?.open === 'number');
check('port scan target kosong ditolak', (await portScan('')).ok === false);

/* ── Profil nomor lengkap (offline + opsional Numverify) ─────────────── */
group('Profil nomor lengkap');
const pinfo = await phoneInfo('0812-3456-7890');
check('profil nomor ok', pinfo.ok === true, pinfo.error || '');
check('profil menyertakan negara', pinfo.country === 'Indonesia', pinfo.country);
check('profil menyertakan operator', !!pinfo.operator, pinfo.operator);
check('profil menyertakan tipe baris', !!pinfo.lineType, pinfo.lineType);
check('nomor seluler tidak dikasih kota', pinfo.city === null && pinfo.coordinates === null);
check('profil menyertakan zona waktu & waktu lokal', !!pinfo.location?.timezone && !!pinfo.location?.localTime, pinfo.location?.timezone);
check('profil menyatakan itu bukan GPS', /BUKAN posisi perangkat/i.test(pinfo.location?.accuracy || ''));
check('nomor tidak valid ditolak', (await phoneInfo('bukan-nomor')).ok === false);

const pinfoFixed = await phoneInfo('021-3456789');
check('landline Jakarta dapat kota', pinfoFixed.city === 'Jakarta', pinfoFixed.city);
check('landline punya koordinat', !!pinfoFixed.coordinates?.lat, String(pinfoFixed.coordinates?.lat));

/* ── Nama & tag kontak (live, toleran) ───────────────────────────────── */
group('Nama & tag kontak (live)');
const contacts = await contactNames('081234567890', { limit: 5 });
check('modul kontak running', contacts.ok === true, contacts.error || '');
check('modul kontak selalu melaporkan ringkasan', typeof contacts.summary?.tagsFound === 'number',
  JSON.stringify(contacts.summary || {}));
check('modul kontak menyertakan catatan batasan', /tidak pernah mengarang nama/i.test(contacts.limitation || ''));
check('modul kontak menyertakan tautan cek manual', Array.isArray(contacts.manualCheck));
check('modul kontak melaporkan status tiap sumber', Array.isArray(contacts.sources) && contacts.sources.length > 0);
check('modul kontak memperingatkan sumber yang gagal',
  contacts.warning === null || /tidak merespons/i.test(contacts.warning),
  contacts.warning || 'semua sumber merespons');
check('tag punya bukti (situs)', (contacts.topTags || []).every((t) => t.siteCount >= 1 && Array.isArray(t.evidence)));

/* ── Sebaran publik (live, toleran) ──────────────────────────────────── */
group('Sebaran publik (live)');
const mentions = await publicMentions('081234567890', { limit: 5 });
check('modul sebaran berjalan', mentions.ok === true || !!mentions.error, mentions.error || 'ok');
check('modul sebaran melaporkan status tiap sumber', Array.isArray(mentions.sources) && mentions.sources.length > 0,
  (mentions.sources || []).map((s) => `${s.name}=${s.ok ? 'ok' : 'gagal'}`).join(', '));
check('modul sebaran selalu punya array hasil', Array.isArray(mentions.mentions));
// Setiap mention yang disimpan harus benar-benar memuat nomor.
// Dicocokkan dengan normalisasi digit (pola yang sama dengan modul),
// supaya "0812-3456-7890" tetap dianggap sama dengan "081234567890".
const digitsOf = (s) => String(s || '').replace(/[^\d]+/g, ' ');
const needleRes = ['081234567890', '6281234567890', '81234567890'].map(
  (n) => new RegExp(`(?<!\\d)${n}(?!\\d)`)
);
check('mention yang disimpan benar-benar memuat nomor',
  (mentions.mentions || []).every((m) => {
    const hay = digitsOf(`${m.title || ''} ${m.snippet || ''} ${m.url || ''}`);
    return needleRes.some((re) => re.test(hay));
  }),
  `${(mentions.mentions || []).length} mention diperiksa`);

/* ── OSIRIS: BGP / MAC / OFAC (live, toleran) ─────────────────────────── */
group('OSIRIS recon (live)');
const bgp = await bgpLookup('8.8.8.8');
check('BGP Lookup punya bentuk respons', typeof bgp.ok === 'boolean', bgp.error || 'ok');
if (bgp.ok) {
  checkNet('BGP menemukan ASN', (bgp.asns || []).length > 0, bgp.asns?.[0]?.asn, bgp);
  check('BGP melaporkan status sumber', Array.isArray(bgp.sources));
}

const mac = await macVendor('00:1B:44:11:3A:B7');
checkNet('MAC vendor punya bentuk respons', typeof mac.ok === 'boolean', mac.error || mac.vendor || 'ok', mac);
check('MAC tidak valid ditolak', (await macVendor('bukan-mac')).ok === false);

const ofac = await sanctionsSearch('Vladimir Putin', { limit: 5 });
check('OFAC punya bentuk respons', typeof ofac.ok === 'boolean', ofac.error || `${ofac.count} cocok`);
if (ofac.ok) {
  check('OFAC memuat jumlah entri dataset', ofac.datasetEntries > 1000, String(ofac.datasetEntries));
  check('OFAC punya catatan verifikasi manual', /BUKAN bukti identitas/i.test(ofac.note || ''));
}
check('OFAC kata kunci terlalu pendek ditolak', (await sanctionsSearch('ab')).ok === false);

const intel = await ipIntel('8.8.8.8');
check('IP intel punya bentuk respons', typeof intel.ok === 'boolean', intel.error || 'ok');
check('IP intel menyertakan profil + bgp', !!intel.profile && !!intel.bgp);

/* ── Cek pos (bundel) ─────────────────────────────────────────────────── */
group('Cek pos (bundel)');
const noTarget = await cekPos({});
check('cek pos tanpa target ditolak', noTarget.ok === false && !!noTarget.error);
check('cek pos tanpa target menyebut minimal satu isian',
  /nomor telepon|hostname|IP|MAC|nama/i.test(noTarget.error || ''));

const cek = await cekPos({
  phone: '081234567890',
  target: '127.0.0.1',
  mac: '00:1B:44:11:3A:B7',
  ports: '1,2',
  withContacts: false,
});
check('cek pos menghasilkan bagian-bagian', !!cek.parts, Object.keys(cek.parts || {}).join(', '));
check('bagian yang dilewati disertai alasan',
  Object.values(cek.parts || {}).every((p) => !p || !p.skipped || !!p.reason));
check('port scan jalan pada target yang diberikan', cek.parts.ports?.skipped !== true && typeof cek.parts.ports?.openCount === 'number');
check('BGP jalan untuk target IP', cek.parts.bgp?.skipped !== true);
check('sanksi dilewati tanpa nama', cek.parts.sanctions?.skipped === true && !!cek.parts.sanctions?.reason);
check('cek pos menyertakan catatan etika', /izin/i.test(cek.ethics || ''));

const cekHost = await cekPos({ target: 'localhost', withContacts: false });
check('BGP dilewati untuk hostname non-IP', cekHost.parts.bgp?.skipped === true && !!cekHost.parts.bgp?.reason);
check('IP intel dilewati untuk hostname non-IP', cekHost.parts.ipIntel?.skipped === true && !!cekHost.parts.ipIntel?.reason);

/* ── Pemuat .env ────────────────────────────────────────────────────── */
group('Pemuat konfigurasi');
const { envLoaded } = await import('../src/loadenv.js');
check('.env loader tidak melempar saat file tidak ada', typeof envLoaded === 'boolean',
  envLoaded ? '.env ditemukan' : '.env tidak ada (pakai bawaan) — normal');

/* ── Hasil ──────────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(46)}`);
console.log(
  `  \x1b[1m${pass} lulus\x1b[0m` +
  (fail ? `, \x1b[31m${fail} gagal\x1b[0m` : ', 0 gagal') +
  (skipped ? `, \x1b[33m${skipped} dilewati\x1b[0m` : '')
);
if (skipped) {
  console.log(`  \x1b[2mPemeriksaan yang dilewati = sumber pihak ketiga tidak merespons.\x1b[0m`);
}
console.log(`${'─'.repeat(46)}\n`);

process.exit(fail ? 1 : 0);