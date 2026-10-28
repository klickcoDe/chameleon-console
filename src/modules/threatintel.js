/**
 * Modul intelijen ancaman: jejak dompet kripto + kerentanan CVE.
 *
 * Diadaptasi dari sumber data open yang dipakai OSIRIS
 * (github.com/simplifaisoul/osiris), memakai API publik yang bisa diakses
 * TANPA API KEY supaya konsisten dengan proyek ini yang nol dependensi:
 *
 *   - BTC : blockstream.info (Esplora API, keyless)
 *   - ETH : eth.blockscout.com (Blockscout API v2, keyless)
 *   - CVE : services.nvd.nist.gov (NVD API 2.0, keyless)
 *
 * Yang TIDAK diintegrasikan dari OSIRIS: vulnerability scanner aktif. Scan
 * kerentanan melakukan probing terhadap host yang dipilih penyerang, bukan
 * membaca data yang sudah dipublikasikan — tidak konsisten dengan prinsip
 * proyek ini (hanya baca data publik) dan berisiko jadi alat serangan.
 * Modul di sini hanya MENCARI DATA yang memang sudah terbuka untuk publik.
 *
 * Port scanner tidak ada di sini juga, tapi sekarang tersedia sebagai modul
 * TERPISAH (src/modules/portscan.js) yang hanya TCP connect, tanpa payload,
 * tanpa banner grabbing, dan hanya berjalan atas target yang Anda tentukan
 * sendiri. Port scan terhadap sistem orang lain tanpa izin tetap ilegal.
 *
 * Catatan penting soal identitas: modul ini memberi metadata BUKAN bukti
 * siapa pemilik wallet-nya. Alamat kripto adalah publik, tetapi tetap harus
 * dianggap sebagai "indikator", bukan identitas.
 */

import { requestJSON } from '../util/http.js';

/* ── Deteksi jenis alamat ─────────────────────────────────────────────── */

const BTC_RE = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const ETH_RE = /^0x[a-fA-F0-9]{40}$/;

/** Deteksi apakah input alamat BTC atau ETH. */
export function detectAddressKind(addr = '') {
  const a = String(addr).trim();
  if (BTC_RE.test(a)) return 'BTC';
  if (ETH_RE.test(a)) return 'ETH';
  return null;
}

/* ── BTC (blockstream.info / Esplora) ──────────────────────────────────── */

/**
 * Ringkasan alamat BTC: saldo, jumlah transaksi, status (!) UTXO.
 * blockstream.info adalah block explorer resmi Bitcoin Core — keyless.
 */
export async function traceBTC(address) {
  const addr = String(address || '').trim();
  if (!BTC_RE.test(addr)) {
    return { ok: false, chain: 'BTC', error: `Alamat BTC tidak valid: "${address}"` };
  }

  try {
    const { status, json } = await requestJSON(
      `https://blockstream.info/api/address/${encodeURIComponent(addr)}`,
      { retries: 1, timeout: 15000 }
    );

    if (status !== 200 || !json) {
      return { ok: false, chain: 'BTC', address: addr, error: `blockstream HTTP ${status}` };
    }

    const cs = json.chain_stats || {};
    const ms = json.mempool_stats || {};

    return {
      ok: true,
      chain: 'BTC',
      address: addr,
      // Semua satuan satoshi (1 BTC = 100_000_000 sat).
      balanceSats: (cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0),
      balanceBTC: (((cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0)) / 1e8).toFixed(8),
      receivedSats: cs.funded_txo_sum || 0,
      sentSats: cs.spent_txo_sum || 0,
      txCount: cs.tx_count || 0,
      // UTXO yang belum dibelanjakan — bisa besar = belum dipindahkan.
      utxoCount: cs.funded_txo_count || 0,
      pendingBalanceSats: (ms.funded_txo_sum || 0) - (ms.spent_txo_sum || 0),
      pendingTxCount: ms.tx_count || 0,
      firstSeen: cs.first_seen ? new Date(cs.first_seen * 1000).toISOString() : null,
      lastSeen: cs.last_seen ? new Date(cs.last_seen * 1000).toISOString() : null,
      source: 'blockstream.info (Esplora API, keyless)',
      note:
        'Saldo dan riwayat transaksi adalah data publik on-chain. Alamat publik BUKAN bukti ' +
        'kepemilikan — orang bisa menyimpan di alamat yang sama. Jangan simpulkan identitas.',
    };
  } catch (err) {
    return { ok: false, chain: 'BTC', address: addr, error: err.message };
  }
}

/* ── ETH (Blockscout) ─────────────────────────────────────────────────── */

/** Ringkasan alamat ETH: saldo, nama label, jumlah transaksi. */
export async function traceETH(address) {
  const addr = String(address || '').trim();
  if (!ETH_RE.test(addr)) {
    return { ok: false, chain: 'ETH', error: `Alamat ETH tidak valid: "${address}"` };
  }

  try {
    const { status, json } = await requestJSON(
      `https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(addr)}`,
      { retries: 1, timeout: 15000 }
    );

    if (status === 404) {
      return {
        ok: true,
        chain: 'ETH',
        address: addr,
        balanceWei: '0',
        known: false,
        note: 'Alamat belum pernah dipakai di mainnet Ethereum.',
      };
    }
    if (status !== 200 || !json) {
      return { ok: false, chain: 'ETH', address: addr, error: `Blockscout HTTP ${status}` };
    }

    return {
      ok: true,
      chain: 'ETH',
      address: addr,
      // Wei: 1 ETH = 10^18 wei.
      balanceWei: json.coin_balance ?? '0',
      balanceETH: ((Number(json.coin_balance || 0)) / 1e18).toFixed(6),
      // Label publik yang they've been given (ERC-20 token contract, exchange, dll).
      name: json.name || null,
      isContract: !!json.is_contract,
      isVerified: !!json.is_verified,
      txCount: json.transaction_count || null,
      source: 'eth.blockscout.com (Blockscout API v2, keyless)',
      note:
        'Label di Blockscout berasal dari label komunitas/ERC-20 registry — bisa salah atau ' +
        'dipalsukan. Perlakukan sebagai petunjuk, bukan fakta terverifikasi.',
    };
  } catch (err) {
    return { ok: false, chain: 'ETH', address: addr, error: err.message };
  }
}

/**
 * Deteksi otomatis jenis alamat lalu telusuri.
 */
export async function traceWallet(address) {
  const kind = detectAddressKind(address);
  if (!kind) {
    return {
      ok: false,
      error:
        `Alamat tidak dikenali sebagai BTC atau ETH. ` +
        `Format BTC: 1.../3.../bc1... | Format ETH: 0x... (40 hex). Input: "${address}"`,
    };
  }
  return kind === 'BTC' ? traceBTC(address) : traceETH(address);
}

/* ── CVE (NVD) ────────────────────────────────────────────────────────── */

/**
 * Cari CVE berdasarkan kata kunci produk (mis. "apache", "nginx", "openssl").
 * NVD API 2.0 keyless. Hasil utama: CVE ID + skor CVSS + ringkasan.
 */
export async function searchCVE(keyword, { limit = 5 } = {}) {
  const kw = String(keyword || '').trim();
  if (kw.length < 2) {
    return { ok: false, error: 'Kata kunci terlalu pendek (minimal 2 karakter).' };
  }

  try {
    const { status, json } = await requestJSON(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(kw)}` +
        `&resultsPerPage=${Math.min(limit, 20)}`,
      { retries: 1, timeout: 20000 }
    );

    if (status !== 200 || !json?.vulnerabilities) {
      return { ok: false, keyword: kw, error: `NVD HTTP ${status}` };
    }

    const items = json.vulnerabilities.map((v) => {
      const cve = v.cve || {};
      const metrics = cve.metrics || {};
      // Ambil skor CVSS v3.1/v3.0 kalau ada, kalau tidak v2.
      const cvss =
        metrics.cvssMetricV31?.[0]?.cvssData ||
        metrics.cvssMetricV30?.[0]?.cvssData ||
        metrics.cvssMetricV2?.[0]?.cvssData ||
        null;

      const severity = cvss?.baseSeverity ||
        (cvss?.baseScore >= 9 ? 'CRITICAL' : cvss?.baseScore >= 7 ? 'HIGH' : cvss?.baseScore >= 4 ? 'MEDIUM' : 'LOW') ||
        'UNKNOWN';

      return {
        id: cve.id,
        published: cve.published,
        lastModified: cve.lastModified,
        severity,
        cvssScore: cvss?.baseScore ?? null,
        summary: (cve.descriptions?.find((d) => d.lang === 'en')?.value || '').slice(0, 300),
        references: (cve.references || []).slice(0, 3).map((r) => r.url),
      };
    });

    // Urutkan dari yang paling parah.
    items.sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0));

    return {
      ok: items.length > 0,
      keyword: kw,
      count: items.length,
      totalResults: json.totalResults ?? null,
      cves: items,
      source: 'NVD API 2.0 (nvd.nist.gov, keyless)',
      note:
        'Daftar CVE bersifat historis — sebuah CVE tidak otomatis berarti produk yang Anda ' +
        'gunakan rentan; versi dan konfigurasinya yang menentukan.',
    };
  } catch (err) {
    return { ok: false, keyword: kw, error: err.message };
  }
}

/**
 * Cek apakah ada CVE untuk VERSI produk tertentu yang terdeteksi.
 * Ini bersifat versi-spesifik — hanya relevan kalau versi sudah diketahui.
 */
export async function checkProductVersion(product, version) {
  const p = String(product || '').trim();
  const v = String(version || '').trim();
  if (!p) return { ok: false, error: 'Nama produk kosong.' };

  // Cari CVE yang menyebut produk + versi.
  const kw = v ? `${p} ${v}` : p;
  const result = await searchCVE(kw, { limit: 8 });
  if (!result.ok) return result;

  return {
    ...result,
    product: p,
    version: v || null,
    note:
      (v
        ? `Mencari CVE yang menyebut "${kw}". `
        : `Mencari CVE untuk "${p}" tanpa versi spesifik. `) +
      'CVSS severity tinggi belum tentu bisa dieksploitasi pada konfigurasi Anda.',
  };
}

export const threatintelTools = [
  { id: 'wallet-trace', label: 'Jejak Dompet Kripto', needs: 'address' },
  { id: 'cve-search', label: 'Cari CVE (NVD)', needs: 'product' },
  { id: 'product-cve', label: 'CVE per Produk/Versi', needs: 'product' },
];