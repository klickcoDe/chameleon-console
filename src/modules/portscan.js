/**
 * Modul "Cek Port Terbuka" — port scan ringan (TCP connect).
 *
 * MODEL: scanner gaya OSIRIS (RECON Toolkit → Port Scanner), tapi dibatasi
 * keras supaya aman & sopan:
 *   - hanya TCP CONNECT (tidak ada SYN stealth, tidak ada UDP scan)
 *   - hanya daftar port umum (atau daftar custom yang diminta user)
 *   - concurrency rendah (default 16) dan timeout pendek
 *   - tidak ada banner grabbing otomatis, tidak ada eksploitasi
 *   - satu request = satu koneksi TCP, sama seperti yang dilakukan browser
 *
 * ETIKA:
 *   Port scan terhadap sistem milik orang lain tanpa izin adalah pelanggaran
 *   hukum di banyak yurisdiksi (UU ITE di Indonesia, CFAA di AS, dsb).
 *   Modul ini berarti untuk menguji sistem milik Anda sendiri atau sistem
 *   yang Anda punya izin tertulis untuk mengujinya.
 *
 * Modul ini SENGAJA tidak dijalankan otomatis saat investigasi form — hanya
 * sebagai tool terpisah yang dipanggil eksplisit.
 */

import net from 'node:net';
import dns from 'node:dns/promises';
import { parseIP } from './network.js';

/* ── Daftar port umum ─────────────────────────────────────────────────── */

/**
 * Port yang paling sering dipakai layanan publik.
 * Nilai = nama layanan standar (IANA).
 */
export const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587,
  993, 995, 1433, 1521, 2049, 2375, 2376, 3000, 3306, 3389, 5000, 5432,
  5900, 6379, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9200, 9300,
  11211, 27017, 28017,
];

const SERVICE_NAMES = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http',
  110: 'pop3', 111: 'rpcbind', 135: 'msrpc', 139: 'netbios-ssn', 143: 'imap',
  443: 'https', 445: 'smb', 465: 'smtps', 587: 'submission', 993: 'imaps',
  995: 'pop3s', 1433: 'mssql', 1521: 'oracle', 2049: 'nfs', 2375: 'docker-api',
  2376: 'docker-tls', 3000: 'http-alt', 3306: 'mysql', 3389: 'rdp',
  5000: 'http-alt', 5432: 'postgres', 5900: 'vnc', 6379: 'redis',
  8000: 'http-alt', 8008: 'http-alt', 8080: 'http-proxy', 8081: 'http-alt',
  8443: 'https-alt', 8888: 'http-alt', 9000: 'http-alt', 9090: 'prometheus',
  9200: 'elasticsearch', 9300: 'elasticsearch', 11211: 'memcached',
  27017: 'mongodb', 28017: 'mongodb',
};

/* ── Pembersihan input ────────────────────────────────────────────────── */

/**
 * Bersihkan daftar port dari input mentah.
 * Menerima "22,80,443", "22-25", ["22","80"], atau campuran.
 * Dibatasi: maksimal 256 port, rentang maksimal 500 port.
 */
export function parsePorts(raw) {
  if (!raw) return [...COMMON_PORTS];

  const items = Array.isArray(raw) ? raw : String(raw).split(/[,\s;]+/);
  const ports = new Set();

  for (const item of items) {
    const s = String(item).trim();
    if (!s) continue;

    const range = s.match(/^(\d{1,5})-(\d{1,5})$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > 65535 || to < from) continue;
      const span = Math.min(to - from + 1, 500);
      for (let p = from; p < from + span; p++) ports.add(p);
      continue;
    }

    if (/^\d{1,5}$/.test(s)) {
      const p = Number(s);
      if (p >= 1 && p <= 65535) ports.add(p);
    }
  }

  const list = [...ports].sort((a, b) => a - b);
  return list.length ? list.slice(0, 256) : [...COMMON_PORTS];
}

/* ── Pemindaian ───────────────────────────────────────────────────────── */

/**
 * Coba satu koneksi TCP ke host:port dengan timeout.
 * Tidak mengirim data apa pun — hanya membuka lalu menutup koneksi.
 */
function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open, extra) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* socket sudah tertutup */ }
      resolve({ port, open, ...extra });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, { service: SERVICE_NAMES[port] || null }));
    socket.once('timeout', () => finish(false, { reason: 'timeout' }));
    socket.once('error', (err) => finish(false, { reason: err.code || err.message }));
    socket.connect(port, host);
  });
}

/**
 * Scan port TCP pada satu host.
 *
 * @param {string} target - hostname atau IP
 * @param {object} opts - { ports, timeout, concurrency }
 */
export async function portScan(targetRaw, opts = {}) {
  const raw = String(targetRaw || '').trim();
  if (!raw) return { ok: false, error: 'Target kosong.' };

  const host = raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].split(':')[0];
  if (!host) return { ok: false, error: `Target tidak valid: "${targetRaw}"` };

  const ports = parsePorts(opts.ports);
  const timeout = Math.min(Math.max(Number(opts.timeout) || 2000, 500), 10000);
  const concurrency = Math.min(Math.max(Number(opts.concurrency) || 16, 1), 64);

  // Resolve hostname ke IP. Untuk IP literal tidak perlu lookup.
  let addresses = [];
  if (parseIP(host)) {
    addresses = [{ address: host, family: parseIP(host).version }];
  } else {
    try {
      const res = await dns.lookup(host, { all: true });
      addresses = res.map((r) => ({ address: r.address, family: r.family }));
    } catch (err) {
      return { ok: false, target: host, error: `Hostname tidak bisa di-resolve: ${err.message}` };
    }
  }

  if (!addresses.length) {
    return { ok: false, target: host, error: 'Tidak ada alamat IP yang ditemukan untuk hostname ini.' };
  }

  const started = Date.now();
  const results = [];

  // Scan hanya alamat pertama (IPv4 biasanya) supaya volume tetap rendah.
  // Alamat lain ditampilkan sebagai informasi.
  const primary = addresses.find((a) => a.family === 4) || addresses[0];

  let cursor = 0;
  async function worker() {
    while (cursor < ports.length) {
      const port = ports[cursor++];
      const res = await probePort(primary.address, port, timeout);
      results.push({ ...res, service: res.service || SERVICE_NAMES[port] || null });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ports.length) }, worker)
  );

  const elapsed = Date.now() - started;
  const open = results.filter((r) => r.open).sort((a, b) => a.port - b.port);
  const filtered = results.filter((r) => !r.open && r.reason === 'ECONNREFUSED');
  const timedOut = results.filter((r) => r.reason === 'timeout');

  return {
    ok: true,
    target: host,
    scannedAddress: primary.address,
    addresses: addresses.map((a) => a.address),
    portsScanned: ports.length,
    open,
    openCount: open.length,
    summary: {
      open: open.length,
      closed: filtered.length,
      filteredOrTimeout: timedOut.length,
    },
    elapsedMs: elapsed,
    note:
      'Port scan TCP CONNECT: satu koneksi per port, tanpa payload dan tanpa ' +
      'banner grabbing. Port tertutup yang di-filter firewall biasanya muncul ' +
      'sebagai timeout, bukan "closed" — jadi hasil ini bisa kurang lengkap.',
    ethics:
      'Hanya jalankan terhadap sistem milik Anda sendiri atau sistem yang Anda ' +
      'miliki izin tertulis untuk mengujinya. Port scan tanpa izin bisa dianggap ' +
      'pelanggaran hukum.',
    generatedAt: new Date().toISOString(),
  };
}

export const portScanTools = [
  { id: 'port-scan', label: 'Cek Port Terbuka', needs: 'ip' },
];
