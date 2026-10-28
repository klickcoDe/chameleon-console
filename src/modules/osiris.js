/**
 * Modul "OSIRIS Toolkit" — recipe recon yang diambil dari pola repo
 * OSIRIS (https://github.com/simplifaisoul/osiris), yaitu jalur
 * /api/osint/* : bgp, mac, sanctions, ip.
 *
 * Yang ditiru:
 *   - bgp       : prefix yang diumumkan + AS pengeriksa + RPKI (RIPEstat, keyless)
 *   - mac       : vendor OUI dari alamat MAC (macvendors.com, keyless)
 *   - sanctions : daftar sanksi OFAC SDN, dicache lokal 24 jam
 *   - ip-intel  : gabungan profil IP + routing BGP
 *
 * Semua sumber keyless & resmi. Modul ini hanya MEMBACA.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { request, requestJSON } from '../util/http.js';
import { parseIP } from './network.js';
import { ipProfile } from './network.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OFAC_DIR = path.join(ROOT, 'data', 'ofac');

const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const OFAC_ALT_URL = 'https://www.treasury.gov/ofac/downloads/alt.csv';
const OFAC_TTL_MS = 24 * 60 * 60 * 1000;

/* ── 1. BGP / Routing (RIPEstat) ──────────────────────────────────────── */

/**
 * Informasi routing untuk satu IP: prefix yang diumumkan, AS pengeriksa,
 * dan status validasi RPKI.
 *
 * Sumber: RIPEstat (RIPE NCC) — keyless, data resmi BGP.
 */
export async function bgpLookup(rawIp) {
  const parsed = parseIP(rawIp);
  if (!parsed) {
    return { ok: false, error: `Alamat IP tidak valid: "${rawIp}"` };
  }
  const { ip } = parsed;

  const get = (call, resource, extra = '') =>
    requestJSON(
      `https://stat.ripe.net/data/${call}/data.json?resource=${encodeURIComponent(resource)}${extra}`,
      { retries: 2, timeout: 15000 }
    ).catch((err) => ({ status: 0, json: null, error: err.message }));

  const [prefix, network] = await Promise.all([
    get('prefix-overview', ip),
    get('network-info', ip),
  ]);

  const pData = prefix.json?.data;
  const nData = network.json?.data;

  if (!pData && !nData) {
    return {
      ok: false,
      ip,
      error: `RIPEstat tidak merespons. ${prefix.error || network.error || ''}`.trim(),
    };
  }

  const asns = (pData?.asns || []).map((a) => ({
    asn: a.asn,
    holder: a.holder || null,
  }));

  // RPKI: apakah prefix tervalidasi asal-usulnya (anti-hijacking).
  const rpki = [];
  const prefixCidr = nData?.prefix || pData?.resource;
  if (prefixCidr && asns.length) {
    const asn = asns[0].asn;
    const res = await get('rpki-validation', `AS${asn}`, `&prefix=${encodeURIComponent(prefixCidr)}`);
    const rd = res.json?.data;
    if (rd) {
      rpki.push({
        asn,
        prefix: prefixCidr,
        status: rd.status || null,
        validatingAsn: rd.validating_asn || null,
      });
    }
  }

  return {
    ok: true,
    ip,
    prefix: prefixCidr || null,
    announced: pData?.announced ?? null,
    block: pData?.block
      ? { resource: pData.block.resource, desc: pData.block.desc, name: pData.block.name }
      : null,
    asns,
    rpki,
    sources: [
      { name: 'RIPEstat prefix-overview', ok: !!pData, error: prefix.error || null },
      { name: 'RIPEstat network-info', ok: !!nData, error: network.error || null },
    ],
    note:
      'Data routing berasal dari BGP publik. Prefix & AS menunjukkan siapa yang ' +
      'mengumumkan alamat ini, BUKAN siapa yang memakai perangkatnya. Kalau prefix-nya ' +
      'kurang spesifik, ip-api/GeoIP juga cenderung menunjuk ke kota pusat operator.',
    generatedAt: new Date().toISOString(),
  };
}

/* ── 2. Vendor MAC (OUI) ──────────────────────────────────────────────── */

/**
 * Vendor perangkat dari prefiks OUI pada alamat MAC.
 * Sumber: macvendors.com (API publik, keyless).
 */
export async function macVendor(rawMac) {
  const mac = String(rawMac || '').trim().replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(mac)) {
    return {
      ok: false,
      error: `Alamat MAC tidak valid: "${rawMac}". Format: AA:BB:CC:DD:EE:FF`,
    };
  }

  try {
    const { status, text } = await request(`https://api.macvendors.com/${mac}`, {
      timeout: 10000,
      retries: 2,
    });

    if (status === 404) {
      return {
        ok: true,
        mac,
        vendor: null,
        note: 'Prefiks OUI ini tidak terdaftar di database vendor publik.',
      };
    }
    if (status !== 200) {
      return { ok: false, mac, error: `macvendors HTTP ${status}` };
    }

    const vendor = (text || '').trim();
    return {
      ok: true,
      mac,
      vendor: vendor || null,
      note:
        'Vendor diambil dari prefiks OUI (3 byte pertama). OUI hanya menunjuk ' +
        'perangkatnya — BUKAN identitas orang yang memakainya.',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, mac, error: err.message };
  }
}

/* ── 3. Sanksi OFAC (SDN) ──────────────────────────────────────────────── */

/**
 * Cache lokal untuk daftar OFAC.
 * Diunduh sekali lalu dipakai 24 jam; setelah itu di-refresh.
 */
let sdnCache = null; // { entries: Map, aliases: Map, fetchedAt, size }

async function loadOfac(force = false) {
  if (!force && sdnCache && Date.now() - sdnCache.fetchedAt < OFAC_TTL_MS) {
    return sdnCache;
  }

  try {
    fs.mkdirSync(OFAC_DIR, { recursive: true });
  } catch {
    /* folder tidak bisa dibuat — cache akan dilewati */
  }

  const sdnFile = path.join(OFAC_DIR, 'sdn.csv');
  const altFile = path.join(OFAC_DIR, 'alt.csv');

  const fresh = (file) => {
    try {
      const st = fs.statSync(file);
      return Date.now() - st.mtimeMs < OFAC_TTL_MS;
    } catch {
      return false;
    }
  };

  let sdnText = '';
  let altText = '';

  if (fresh(sdnFile)) {
    sdnText = fs.readFileSync(sdnFile, 'utf8');
  } else {
    const res = await request(OFAC_SDN_URL, { timeout: 120000, retries: 1 });
    if (res.status !== 200) throw new Error(`Unduh SDN.CSV gagal (HTTP ${res.status})`);
    sdnText = res.text;
    try { fs.writeFileSync(sdnFile, sdnText); } catch { /* cache opsional */ }
  }

  if (fresh(altFile)) {
    altText = fs.readFileSync(altFile, 'utf8');
  } else {
    try {
      const res = await request(OFAC_ALT_URL, { timeout: 60000, retries: 0 });
      if (res.status === 200) {
        altText = res.text;
        try { fs.writeFileSync(altFile, altText); } catch { /* cache opsional */ }
      }
    } catch {
      /* alias bersifat opsional */
    }
  }

  const entries = new Map();
  const aliases = new Map();

  // Format SDN.csv: ent_num,"NAME",type,"PROGRAM",... (nilai kosong = "-0- ")
  for (const line of sdnText.split('\n')) {
    const m = line.match(/^(\d+),"((?:[^"]|"")*)",([^,]*),("?[^,"]*"?)/);
    if (!m) continue;
    const id = m[1];
    const name = m[2].replace(/""/g, '"').trim();
    if (!name) continue;

    // Kolom tipe: "-0-" = entitas, "individual" = orang, "vessel"/"aircraft".
    const rawType = m[3].replace(/"/g, '').trim();
    const type = !rawType || rawType === '-0-' ? 'entity' : rawType;

    const program = m[4].replace(/"/g, '').trim();
    entries.set(id, { id, name, type, program });
  }

  // Format ALT.csv: ent_num,alt_num,"aka","ALT NAME",-0-
  for (const line of altText.split('\n')) {
    const m = line.match(/^(\d+),\d+,"[^"]*","((?:[^"]|"")*)"/);
    if (!m) continue;
    const alias = m[2].replace(/""/g, '"').trim();
    if (!alias) continue;
    if (!aliases.has(m[1])) aliases.set(m[1], []);
    aliases.get(m[1]).push(alias);
  }

  sdnCache = { entries, aliases, fetchedAt: Date.now(), size: entries.size };
  return sdnCache;
}

/** Normalisasi nama untuk perbandingan: huruf besar, tanpa tanda baca. */
const normName = (s) =>
  String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cari nama di daftar resmi OFAC SDN.
 *
 * @param {string} query - nama orang / organisasi / kapal
 * @param {object} opts - { limit }
 */
export async function sanctionsSearch(query, { limit = 20 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) {
    return { ok: false, error: 'Kata kunci terlalu pendek (minimal 3 karakter).' };
  }

  let cache;
  try {
    cache = await loadOfac();
  } catch (err) {
    return {
      ok: false,
      error: `Daftar OFAC tidak bisa dimuat: ${err.message}`,
      hint: 'Periksa koneksi internet, lalu coba lagi.',
    };
  }

  const needle = normName(q);
  const matches = [];

  for (const entry of cache.entries.values()) {
    const names = [entry.name, ...(cache.aliases.get(entry.id) || [])];
    let best = null;

    for (const name of names) {
      const n = normName(name);
      if (!n) continue;
      let score = 0;
      if (n === needle) score = 100;
      else if (n.startsWith(needle)) score = 80;
      else if (n.includes(needle)) score = 60;
      else {
        // Cocok token: semua kata kunci ada di nama.
        const tokens = needle.split(' ').filter((t) => t.length > 2);
        if (tokens.length && tokens.every((t) => n.includes(t))) score = 45;
      }
      if (score && (!best || score > best.score)) {
        best = { score, name, isAlias: name !== entry.name };
      }
    }

    if (best) {
      matches.push({
        id: entry.id,
        name: entry.name,
        matchedName: best.name,
        viaAlias: best.isAlias,
        type: entry.type,
        program: entry.program,
        score: best.score,
        aliases: (cache.aliases.get(entry.id) || []).slice(0, 5),
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    ok: true,
    query: q,
    dataset: 'OFAC SDN (Specially Designated Nationals & Blocked Persons)',
    datasetEntries: cache.size,
    datasetFetchedAt: new Date(cache.fetchedAt).toISOString(),
    count: matches.length,
    matches: matches.slice(0, limit),
    note:
      'Daftar OFAC adalah daftar resmi orang/organisasi yang dibekukan asetnya oleh ' +
      ' Departemen Keuangan AS. Kecocokan nama BUKAN bukti identitas — nama orang bisa ' +
      'sama. Verifikasi di sumber resmi (sanctionssearch.ofac.treas.gov) sebelum ' +
      'menyimpulkan.',
    generatedAt: new Date().toISOString(),
  };
}

/* ── 4. IP Intel gabungan ─────────────────────────────────────────────── */

/**
 * Gabungan profil GeoIP + routing BGP untuk satu IP.
 * Ini padanan panel "IP Intelligence" di OSIRIS.
 */
export async function ipIntel(rawIp) {
  const parsed = parseIP(rawIp);
  if (!parsed) {
    return { ok: false, error: `Alamat IP tidak valid: "${rawIp}"` };
  }

  const [profile, bgp] = await Promise.all([
    ipProfile(parsed.ip).catch((err) => ({ ok: false, error: err.message })),
    bgpLookup(parsed.ip).catch((err) => ({ ok: false, error: err.message })),
  ]);

  return {
    ok: profile.ok || bgp.ok,
    ip: parsed.ip,
    profile,
    bgp,
    note:
      'Profil GeoIP menunjuk ke kota pusat operator (bisa ratusan km dari lokasi ' +
      'sebenarnya), sedangkan data BGP menunjuk ke pemilik jaringan. Keduanya bukan ' +
      'lokasi orang.',
    generatedAt: new Date().toISOString(),
  };
}

export const osirisTools = [
  { id: 'bgp', label: 'Routing BGP (RIPEstat)', needs: 'ip' },
  { id: 'ip-intel', label: 'IP Intel Gabungan', needs: 'ip' },
  { id: 'mac-vendor', label: 'Vendor MAC (OUI)', needs: 'mac' },
  { id: 'sanctions-search', label: 'Cek Sanksi OFAC', needs: 'name' },
];
