/**
 * Modul "Cek Pos & Recon" — payung untuk tiga gaya pemeriksaan yang
 * diminta: (1) port scan ringan, (2) pencarian sebaran publik / posting
 * yang menyebut nomor, dan (3) pemeriksaan lanjutan ala OSIRIS
 * (routing BGP, vendor MAC, intelijen IP).
 *
 * Modul ini hanya ORKESTRASI: tiap bagian memanggil modul yang sudah
 * ada (portscan.js, mentions.js, osiris.js) dan merangkai hasilnya.
 * Tidak ada logika jaringan baru di sini.
 *
 * ATURAN PENTANG:
 *   - Port scan TIDAK pernah dijalankan otomatis tanpa target eksplisit.
 *     Kalau `target` kosong, bagian port scan dilewati dan diberi alasan.
 *   - Tidak ada payload, tidak ada banner grabbing, tidak ada eksploitasi.
 *   - Setiap bagian melaporkan status sendiri; satu bagian gagal tidak
 *     menggagalkan yang lain.
 */

import { portScan } from './portscan.js';
import { publicMentions } from './mentions.js';
import { bgpLookup, macVendor, ipIntel, sanctionsSearch } from './osiris.js';
import { contactNames } from './contacts.js';

const err = (e) => ({ ok: false, error: e?.message || String(e) });

/**
 * Jalankan satu bundle "cek pos".
 *
 * @param {object} raw - {
 *   phone?    : nomor untuk sebaran publik + nama/tag kontak,
 *   target?   : hostname/IP untuk port scan + recon IP,
 *   mac?      : alamat MAC untuk lookup vendor OUI,
 *   ports?    : daftar port (string "22,80" atau array),
 *   withContacts? : jalankan juga pencarian nama & tag kontak (default true)
 * }
 */
export async function cekPos(raw = {}) {
  const phone = String(raw.phone || raw.number || '').trim();
  const target = String(raw.target || raw.ip || '').trim();
  const mac = String(raw.mac || '').trim();
  const name = String(raw.name || raw.query || '').trim();

  if (!phone && !target && !mac && !name) {
    return {
      ok: false,
      error:
        'Isi minimal satu target: nomor telepon (untuk sebaran publik & tag kontak), ' +
        'hostname/IP (untuk port scan & routing), alamat MAC (untuk vendor OUI), ' +
        'atau nama (untuk cek sanksi OFAC).',
    };
  }

  const withContacts = raw.withContacts !== false;
  const limit = Number(raw.limit) || 20;

  const parts = {};

  /* ── 1. Sebaran publik (posting/mention yang menyebut nomor) ── */
  if (phone) {
    parts.mentions = await publicMentions(phone, { limit })
      .catch((e) => err(e));
  } else {
    parts.mentions = {
      skipped: true,
      reason: 'Tidak ada nomor telepon yang diberikan — sebaran publik hanya bisa dicari per nomor.',
    };
  }

  /* ── 2. Nama & tag kontak (fitur utama: nama yang disimpan orang lain) ── */
  if (phone) {
    parts.contacts = withContacts
      ? await contactNames(phone, { limit }).catch((e) => err(e))
      : { skipped: true, reason: 'Pencarian nama & tag kontak dilewati (withContacts=false).' };
  } else {
    parts.contacts = {
      skipped: true,
      reason: 'Tidak ada nomor telepon yang diberikan — nama & tag kontak hanya bisa dicari per nomor.',
    };
  }

  /* ── 3. Port scan ringan (hanya kalau target eksplisit) ── */
  if (target) {
    parts.ports = await portScan(target, {
      ports: raw.ports,
      timeout: raw.timeout,
      concurrency: raw.concurrency,
    }).catch((e) => err(e));
  } else {
    parts.ports = {
      skipped: true,
      reason:
        'Port scan tidak dijalankan — tidak ada target host/IP. Port scan terhadap ' +
        'sistem orang lain tanpa izin itu ilegal, jadi modul ini tidak pernah ' +
        'memilih target sendiri.',
    };
  }

  /* ── 4. Recon lanjutan ala OSIRIS ── */
  if (target) {
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(target) || target.includes(':');
    if (isIp) {
      parts.bgp = await bgpLookup(target).catch((e) => err(e));
      parts.ipIntel = await ipIntel(target).catch((e) => err(e));
    } else {
      parts.bgp = {
        skipped: true,
        reason:
          'Routing BGP butuh alamat IP, bukan hostname. Isi kolom IP dengan alamat ' +
          'numerik hasil resolusi DNS.',
      };
      parts.ipIntel = { skipped: true, reason: 'IP intel butuh alamat IP numerik.' };
    }
  } else {
    parts.bgp = { skipped: true, reason: 'Tidak ada target IP yang diberikan.' };
    parts.ipIntel = { skipped: true, reason: 'Tidak ada target IP yang diberikan.' };
  }

  if (mac) {
    parts.mac = await macVendor(mac).catch((e) => err(e));
  } else {
    parts.mac = { skipped: true, reason: 'Tidak ada alamat MAC yang diberikan.' };
  }

  /* ── 5. Sanksi OFAC ── */
  if (name) {
    parts.sanctions = await sanctionsSearch(name, { limit }).catch((e) => err(e));
  } else {
    parts.sanctions = { skipped: true, reason: 'Tidak ada nama yang diberikan untuk dicocokkan dengan daftar OFAC.' };
  }

  const ran = Object.entries(parts).filter(([, v]) => v && !v.skipped);

  return {
    ok: ran.length > 0,
    target: { phone: phone || null, target: target || null, mac: mac || null },
    parts,
    summary: {
      mentions: parts.mentions?.count ?? 0,
      sites: parts.mentions?.sites?.length ?? 0,
      tags: parts.contacts?.summary?.tagsFound ?? 0,
      names: parts.contacts?.summary?.namesFound ?? 0,
      openPorts: parts.ports?.openCount ?? 0,
      asn: parts.bgp?.asns?.[0]?.asn ?? null,
      riskLevel: parts.contacts?.summary?.riskLevel ?? null,
    },
    note:
      'Bundle ini menggabungkan tiga gaya pemeriksaan: sebaran publik, nama & tag ' +
      'kontak, port scan ringan, dan routing/intelijen IP. Bagian yang dilewati ' +
      'sertakan alasannya di field "skipped" — tidak ada bagian yang diam-diam ' +
      'dilewati tanpa penjelasan.',
    ethics:
      'Port scan hanya boleh dijalankan terhadap sistem milik Anda sendiri atau ' +
      'sistem yang Anda punya izin tertulis untuk mengujinya.',
    generatedAt: new Date().toISOString(),
  };
}

export const cekPosTools = [
  { id: 'cek-pos', label: 'Cek Pos & Recon (bundel)', needs: 'phone' },
];
