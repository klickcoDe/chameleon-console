/**
 * HTTP server: API + berkas statis.
 * Nol dependensi — hanya modul bawaan Node.
 */

// Harus pertama: memuat .env sebelum config.js membacanya.
import './src/loadenv.js';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { envSummary } from './src/loadenv.js';
import { config } from './src/config.js';
import {
  investigate,
  investigatePhone,
  searchUsername,
  geocode,
  geolocateIP,
  checkBreach,
  checkPassword,
  buildDorks,
} from './src/investigator.js';
import { clientIP } from './src/modules/location.js';
import { platformNames, PLATFORMS } from './src/modules/social.js';
import {
  dnsLookup,
  whoisLookup,
  findSubdomains,
  httpProbe,
  waybackHistory,
  siteFingerprint,
  domainTools,
} from './src/modules/domain.js';
import {
  ipProfile,
  ipOwnership,
  reverseIP,
  scanHistory,
  networkTools,
} from './src/modules/network.js';
import {
  phoneReputation,
  usernameReputation,
  reputationDorks,
  reputationTools,
} from './src/modules/reputation.js';
import {
  inspectTLS,
  checkExposedPaths,
  checkSecurityTxt,
  fullWebPosture,
  websecTools,
} from './src/modules/websec.js';
import {
  traceWallet,
  searchCVE,
  checkProductVersion,
  threatintelTools,
} from './src/modules/threatintel.js';
import { phoneInfo, phoneInfoTools } from './src/modules/phoneinfo.js';
import { publicMentions, mentionsTools } from './src/modules/mentions.js';
import { contactNames, contactTools } from './src/modules/contacts.js';
import { portScan, portScanTools } from './src/modules/portscan.js';
import { bgpLookup, ipIntel, macVendor, sanctionsSearch, osirisTools } from './src/modules/osiris.js';
import { cekPos, cekPosTools } from './src/modules/cekpos.js';
import {
  hashAll,
  identifyHash,
  decodeAuto,
  analysePassword,
  cryptoTools,
} from './src/util/crypto.js';
import {
  handleTransform,
  toMaltegoCSV,
  toClipboardText,
  toLinkText,
  toJSON,
  maltegoMeta,
  importGuide,
} from './src/modules/maltego.js';
import { readHistory, clearHistory } from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

/* ── Helper ───────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAX_BODY = 256 * 1024; // 256 KB

function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body terlalu besar (maks 256 KB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Body bukan JSON valid'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const full = path.join(PUBLIC, path.normalize(rel));
  // Cegah path traversal.
  if (!full.startsWith(PUBLIC)) return sendText(res, 403, 'Forbidden');

  fs.readFile(full, (err, data) => {
    if (err) return sendText(res, 404, '404 — halaman tidak ditemukan');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/* ── Rate limiter sederhana per IP ────────────────────────────────────── */

const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_HITS = 60;

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  // Bersihkan sesekali agar Map tidak membengkak.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  return list.length > MAX_HITS;
}

/* ── Route table ──────────────────────────────────────────────────────── */

const routes = {
  'GET /api/health': async () => ({
    ok: true,
    service: 'chameleon-console',
    version: config.version,
    uptime: process.uptime(),
    config: envSummary(),
    modules: {
      phone: 'aktif',
      social: `aktif (${PLATFORMS.length} platform)`,
      location: 'aktif',
      breach: config.hibpKey ? 'aktif (HIBP key terpasang)' : 'butuh HIBP_API_KEY',
      domain: `aktif (${domainTools.length} tool: DNS, WHOIS, subdomain, headers, fingerprint, arsip)`,
      network: `aktif (${networkTools.length} tool: profil IP, kepemilikan, reverse IP, scan)`,
      forensics: `aktif (${cryptoTools.length} tool: hash, identifikasi, dekoder, password)`,
      reputation: `aktif (${reputationTools.length} tool: tag & skor spam)`,
      websec: `aktif (${websecTools.length} tool: TLS, path terbuka, security.txt)`,
      threatintel: `aktif (${threatintelTools.length} tool: dompet kripto, CVE)`,
      phoneinfo: `aktif (${phoneInfoTools.length} tool: profil nomor, area, zona waktu)`,
      contacts: `aktif (${contactTools.length} tool: nama & tag kontak dari jejak publik)`,
      mentions: `aktif (${mentionsTools.length} tool: sebaran publik nomor)`,
      portscan: `aktif (${portScanTools.length} tool: port TCP connect)`,
      osiris: `aktif (${osirisTools.length} tool: BGP, MAC vendor, OFAC, IP intel)`,
      cekpos: `aktif (${cekPosTools.length} tool: bundel cek pos & recon)`,
      maltego: `Transform Provider aktif di ${config.maltego.providerUrl}`,
    },
  }),

  'GET /api/platforms': async () => ({
    ok: true,
    count: PLATFORMS.length,
    platforms: PLATFORMS.map((p) => ({
      name: p.name,
      urlTemplate: p.url('${username}'),
    })),
  }),

  /**
   * Registry semua tool yang tersedia. Frontend membaca daftar ini untuk
   * membangun sidebar, jadi menambah tool baru cukup dilakukan di backend —
   * tidak perlu menyentuh HTML.
   */
  'GET /api/tools': async () => ({
    ok: true,
    categories: [
      {
        id: 'identity',
        label: 'Identitas & Sosial',
        tools: [
          { id: 'investigate', label: 'Investigasi Lengkap', endpoint: 'POST /api/investigate', needs: 'form' },
          { id: 'phone', label: 'Nomor / WhatsApp', endpoint: 'POST /api/phone', needs: 'phone' },
          { id: 'social', label: 'Username Lintas Platform', endpoint: 'POST /api/social', needs: 'username' },
          { id: 'breach', label: 'Cek Kebocoran Data', endpoint: 'POST /api/breach', needs: 'email' },
          ...phoneInfoTools.map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
          ...contactTools.map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
          ...mentionsTools.map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
          ...cekPosTools.map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
        ],
      },
      {
        id: 'domain',
        label: 'Domain & Web',
        tools: domainTools.map((t) => ({
          ...t,
          endpoint: `POST /api/${t.id}`,
        })),
      },
      {
        id: 'network',
        label: 'Jaringan & IP',
        tools: [
          ...networkTools.map((t) => ({
            ...t,
            endpoint: `POST /api/${t.id}`,
          })),
          ...portScanTools.map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
          ...osirisTools
            .filter((t) => t.id !== 'sanctions-search')
            .map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
        ],
      },
      {
        id: 'location',
        label: 'Lokasi',
        tools: [
          { id: 'geocode', label: 'Geocode Nama Tempat', endpoint: 'POST /api/geocode', needs: 'location' },
          { id: 'geolocate-ip', label: 'Geolokasi IP', endpoint: 'POST /api/geolocate-ip', needs: 'ip' },
        ],
      },
      {
        id: 'forensics',
        label: 'Forensik & Utilitas',
        tools: cryptoTools.map((t) => ({
          ...t,
          endpoint: `POST /api/${t.id === 'password' ? 'password-strength' : t.id}`,
        })),
      },
      {
        id: 'reputation',
        label: 'Reputasi & Tag',
        tools: reputationTools.map((t) => ({
          ...t,
          endpoint: `POST /api/${t.id}`,
        })),
      },
      {
        id: 'websec',
        label: 'Kelemahan Website',
        tools: websecTools.map((t) => ({
          ...t,
          endpoint: `POST /api/${t.id}`,
        })),
      },
      {
        id: 'threatintel',
        label: 'Intelijen Ancaman',
        tools: [
          ...threatintelTools.map((t) => ({
            ...t,
            endpoint: `POST /api/${t.id}`,
          })),
          ...osirisTools
            .filter((t) => t.id === 'sanctions-search')
            .map((t) => ({ ...t, endpoint: `POST /api/${t.id}` })),
        ],
      },
    ],
  }),

  /* ── Domain & web ─────────────────────────────────────────────────── */
  'POST /api/dns': async (req) => {
    const { domain, type } = await readBody(req);
    const data = await dnsLookup(domain, type || 'ANY');
    return { status: data.ok || data.notFound ? 200 : 400, data };
  },

  'POST /api/whois': async (req) => {
    const { domain } = await readBody(req);
    const data = await whoisLookup(domain);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/subdomains': async (req) => {
    const { domain } = await readBody(req);
    const data = await findSubdomains(domain);
    return { status: data.ok ? 200 : 200, data };
  },

  'POST /api/headers': async (req) => {
    const { url } = await readBody(req);
    const data = await httpProbe(url);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/fingerprint': async (req) => {
    const { url } = await readBody(req);
    const data = await siteFingerprint(url);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/wayback': async (req) => {
    const { url, limit } = await readBody(req);
    const data = await waybackHistory(url, { limit: Number(limit) || 20 });
    return { status: data.ok ? 200 : 200, data };
  },

  /* ── Jaringan & IP ────────────────────────────────────────────────── */
  'POST /api/ip-profile': async (req) => {
    const { ip } = await readBody(req);
    const data = await ipProfile(ip);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/ip-owner': async (req) => {
    const { ip } = await readBody(req);
    const data = await ipOwnership(ip);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/reverse-ip': async (req) => {
    const { ip } = await readBody(req);
    const data = await reverseIP(ip);
    return { status: data.ok ? 200 : 200, data };
  },

  'POST /api/scan-history': async (req) => {
    const { target, size } = await readBody(req);
    const data = await scanHistory(target, { size: Number(size) || 20 });
    return { status: data.ok ? 200 : 200, data };
  },

  /* ── Forensik & utilitas ──────────────────────────────────────────── */
  'POST /api/hash': async (req) => {
    const { input } = await readBody(req);
    if (typeof input !== 'string' || !input.length) {
      return { status: 400, data: { ok: false, error: 'Input teks kosong.' } };
    }
    if (input.length > 100_000) {
      return { status: 400, data: { ok: false, error: 'Input terlalu panjang (maks 100.000 karakter).' } };
    }
    return { status: 200, data: { ok: true, length: input.length, hashes: hashAll(input) } };
  },

  'POST /api/identify': async (req) => {
    const { hash } = await readBody(req);
    const data = identifyHash(hash);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/decode': async (req) => {
    const { input } = await readBody(req);
    const data = decodeAuto(input);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/password-strength': async (req) => {
    const { password } = await readBody(req);
    const data = analysePassword(password);
    return { status: data.ok ? 200 : 400, data };
  },

  /* ── Reputasi & tag ───────────────────────────────────────────────── */
  'POST /api/phone-reputation': async (req) => {
    const { number, phone, ip } = await readBody(req);
    const data = await phoneReputation(number || phone, { ip });
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/username-reputation': async (req) => {
    const { username } = await readBody(req);
    const data = await usernameReputation(username);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/reputation-dorks': async (req) => {
    const { number, phone } = await readBody(req);
    const data = reputationDorks(number || phone);
    return { status: data.ok ? 200 : 400, data };
  },

  /* ── Kelemahan website (pasif) ───────────────────────────────────── */
  'POST /api/tls-inspect': async (req) => {
    const { url, host, port } = await readBody(req);
    const data = await inspectTLS(url || host, Number(port) || 443);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/web-paths': async (req) => {
    const { url } = await readBody(req);
    const data = await checkExposedPaths(url);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/security-txt': async (req) => {
    const { url } = await readBody(req);
    const data = await checkSecurityTxt(url);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/web-posture': async (req) => {
    const { url } = await readBody(req);
    const data = await fullWebPosture(url);
    return { status: data.ok ? 200 : 400, data };
  },

  /* ── Intelijen ancaman (kripto + CVE) ────────────────────────────── */
  'POST /api/wallet-trace': async (req) => {
    const { address } = await readBody(req);
    const data = await traceWallet(address);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/cve-search': async (req) => {
    const { keyword, product, limit } = await readBody(req);
    const data = await searchCVE(keyword || product, { limit: Number(limit) || 5 });
    return { status: data.ok ? 200 : 200, data };
  },

  'POST /api/product-cve': async (req) => {
    const { product, version } = await readBody(req);
    const data = await checkProductVersion(product, version);
    return { status: data.ok ? 200 : 200, data };
  },

  /* ── Nomor: profil lengkap, nama & tag, sebaran publik ─────────── */
  'POST /api/phone-info': async (req) => {
    const { number, phone } = await readBody(req);
    const data = await phoneInfo(number || phone);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/contact-names': async (req) => {
    const { number, phone, limit } = await readBody(req);
    const data = await contactNames(number || phone, { limit: Number(limit) || 20 });
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/mentions': async (req) => {
    const { number, phone, limit } = await readBody(req);
    const data = await publicMentions(number || phone, { limit: Number(limit) || 20 });
    return { status: data.ok ? 200 : 200, data };
  },

  'POST /api/cek-pos': async (req) => {
    const data = await cekPos(await readBody(req));
    return { status: data.ok ? 200 : 400, data };
  },

  /* ── Recon lanjutan ala OSIRIS ─────────────────────────────────── */
  'POST /api/port-scan': async (req) => {
    const { target, ip, ports, timeout, concurrency } = await readBody(req);
    const data = await portScan(target || ip, { ports, timeout, concurrency });
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/bgp': async (req) => {
    const { ip, target } = await readBody(req);
    const data = await bgpLookup(ip || target);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/ip-intel': async (req) => {
    const { ip, target } = await readBody(req);
    const data = await ipIntel(ip || target);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/mac-vendor': async (req) => {
    const { mac } = await readBody(req);
    const data = await macVendor(mac);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/sanctions-search': async (req) => {
    const { query, name, limit } = await readBody(req);
    const data = await sanctionsSearch(query || name, { limit: Number(limit) || 20 });
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/investigate': async (req) => {
    const body = await readBody(req);
    const report = await investigate(body, { ip: clientIP(req) });
    return { status: report.ok ? 200 : 400, data: report };
  },

  'POST /api/phone': async (req) => {
    const { number, phone } = await readBody(req);
    const data = await investigatePhone(number || phone);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/social': async (req) => {
    const { username, platforms } = await readBody(req);
    const data = await searchUsername(username, Array.isArray(platforms) ? platforms : []);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/geocode': async (req) => {
    const { location, query } = await readBody(req);
    const data = await geocode(location || query);
    return { status: data.ok ? 200 : 404, data };
  },

  'POST /api/geolocate-ip': async (req) => {
    const { ip } = await readBody(req);
    const data = await geolocateIP(ip);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/breach': async (req) => {
    const { email } = await readBody(req);
    const data = await checkBreach(email);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/password-check': async (req) => {
    const { password } = await readBody(req);
    const data = await checkPassword(password);
    return { status: data.ok ? 200 : 400, data };
  },

  'POST /api/dorks': async (req) => {
    const data = buildDorks(await readBody(req));
    return { status: 200, data };
  },

  'GET /api/maltego': async () => ({
    providerUrl: config.maltego.providerUrl,
    platforms: platformNames,
    methods: maltegoMeta.methods,
    unavailable: maltegoMeta.unavailable,
    guide: importGuide,
  }),

  'POST /api/maltego/transform': async (req) => {
    // Protokol Transform Maltego: balasan SELALU 200 dengan JSON transform.
    // Error dibungkus di status_message, bukan HTTP error.
    const body = await readBody(req);
    return { status: 200, data: await handleTransform(body) };
  },

  'GET /api/history': async (req, url) => {
    const limit = Number(url.searchParams.get('limit') || 50);
    return { ok: true, data: readHistory(Math.min(limit, 500)) };
  },

  'DELETE /api/history': async () => {
    const cleared = clearHistory();
    return {
      ok: cleared,
      message: cleared ? 'Riwayat dibersihkan.' : 'Gagal membersihkan riwayat.',
    };
  },
};

/**
 * Bangun graph dari body form lalu jalankan investigasi.
 * Dipakai oleh route ekspor agar tidak ada duplikasi logika.
 */
async function graphFromBody(body) {
  const report = await investigate(body, { ip: null });
  return report.graph || { entities: [], links: [] };
}

/* ── Server ───────────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Header keamanan dasar.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, DELETE, OPTIONS' });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    if (rateLimited(clientIP(req))) {
      return sendJSON(res, 429, { ok: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
    }

    /* Ekspor (kirim berkas/teks, bukan JSON) */
    if (pathname.startsWith('/api/export/') && req.method === 'POST') {
      const format = pathname.split('/').pop();
      try {
        const body = await readBody(req);
        const graph = await graphFromBody(body);

        switch (format) {
          // Format yang benar-benar didukung importer Maltego CE.
          case 'csv':
            return sendText(res, 200, toMaltegoCSV(graph), 'text/csv; charset=utf-8');
          case 'clipboard':
            return sendText(res, 200, toClipboardText(graph));
          case 'links':
            return sendText(res, 200, toLinkText(graph));

          // Arsip internal, BUKAN format impor Maltego.
          case 'json':
            return sendText(res, 200, toJSON(graph), 'application/json; charset=utf-8');

          default:
            return sendJSON(res, 400, {
              ok: false,
              error: `Format "${format}" tidak dikenal.`,
              available: ['csv', 'clipboard', 'links', 'json'],
              note:
                'Untuk masuk ke Maltego CE gunakan csv (3rd party table) atau ' +
                'clipboard. Format json hanya untuk arsip, bukan impor.',
            });
        }
      } catch (err) {
        return sendJSON(res, 400, { ok: false, error: err.message });
      }
    }

    const key = `${req.method} ${pathname}`;
    const handler = routes[key];

    if (!handler) {
      return sendJSON(res, 404, {
        ok: false,
        error: `Endpoint tidak ditemukan: ${key}`,
        endpoints: Object.keys(routes),
      });
    }

    try {
      const result = await handler(req, url);
      if (result && typeof result.status === 'number' && 'data' in result) {
        return sendJSON(res, result.status, result.data);
      }
      return sendJSON(res, 200, result);
    } catch (err) {
      console.error(`[api] ${key}:`, err);
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  }

  // Root POST = titik masuk Protokol Transform Maltego.
  // Maltego mengonfigurasi URL transform provider sebagai http://localhost:PORT/
  // lalu mengirim POST ke sana setiap kali user menekan Run.
  if (pathname === '/' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 200, await handleTransform(body));
    } catch (err) {
      return sendJSON(res, 200, {
        transforms: [],
        returnedEntities: [],
        status_message: `Transform gagal: ${err.message}`,
        status_type: 1,
      });
    }
  }

  // Statis
  if (req.method !== 'GET') return sendText(res, 405, 'Method not allowed');
  return serveStatic(req, res, pathname);
});

/**
 * Pesan yang bisa dibaca manusia untuk kegagalan umum.
 * Tanpa ini Node hanya mencetak stack trace yang tidak menjelaskan apa sebenarnya
 * yang terjadi.
 */
function startFailHint(err) {
if (err.code === 'EADDRINUSE') {
    const W = 62;
    const line = (txt) => `  │ ${txt.padEnd(W - 3)}│`;
    console.error(`
  ┌${'─'.repeat(W)}┐
${line('GAGAL START — port ' + config.port + ' sedang dipakai')}
  ├${'─'.repeat(W)}┤
${line('Instance lain masih jalan. Matikan dengan:')}
${line('    kill $(lsof -ti tcp:' + config.port + ')')}
${line('')}
${line('Atau pakai port lain:')}
${line('    PORT=3001 node server.js')}
  └${'─'.repeat(W)}┘
`);
  } else if (err.code === 'EACCES') {
    console.error(`\n  GAGAL START — tidak punya izin untuk memakai port ${config.port}.`);
    console.error(`  Port < 1024 butuh hak administrator. Coba: PORT=3000 node server.js\n`);
  } else {
    console.error(`\n  GAGAL START — ${err.message}\n`);
  }
}

server.on('error', (err) => {
  startFailHint(err);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  const W = 62;
  const bar = '─'.repeat(W);
  const line = (txt) => `  │ ${String(txt).slice(0, W - 3).padEnd(W - 3)}│`;
  const env = envSummary();
  console.log(`
  ┌${bar}┐
${line('  CHAMELEON CONSOLE — aktif')}
  ├${bar}┤
${line('  UI        ' + url)}
${line('  API       ' + url + '/api/health')}
  ├${bar}┤
${line('  .env      ' + (env.fileFound ? 'dibaca' : 'tidak ada — pakai nilai bawaan'))}
${line('  HIBP key  ' + (config.hibpKey ? 'terpasang' : 'BELUM — modul breach nonaktif'))}
${line('  WA token  ' + (config.meta.waToken ? 'terpasang (validasi kredensial)' : 'belum'))}
${line('  Maltego   Transform Provider aktif (port ' + config.port + ')')}
  └${bar}┘
`);
});

process.on('SIGINT', () => {
  console.log('\nServer dihentikan.');
  process.exit(0);
});