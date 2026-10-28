/**
 * Pemuat .env + pengaturan jaringan proses.
 *
 * WAJIB diimpor paling pertama, sebelum config.js, karena ES module
 * dievaluasi berurutan sesuai urutan import.
 *
 * Node 20.12+ punya process.loadEnvFile() bawaan, jadi tanpa dependensi.
 * Berkas .env tidak wajib ada — kalau tidak ada, konfigurasi bawaan dipakai.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

/**
 * Paksa urutan koneksi ke IPv4 lebih dulu.
 *
 * Node 20+ memakai "Happy Eyeballs" (autoSelectFamily): mencoba IPv6 dan
 * IPv4 secara bersamaan lalu memakai yang connect duluan. Masalahnya muncul
 * di jaringan yang punya AAAA record tapi tanpa jalur IPv6 sungguhan
 * (jaringan korporat, container, sebagian VPN): percobaan IPv6 gagal dengan
 * error yang tidak diperlakukan sebagai "coba alamat berikutnya", lalu Node
 * gagal total meski IPv4-nya sehat.
 *
 * Gejalanya nyata dan sudah diuji di lingkungan proyek ini:
 *   fetch('https://api.certspotter.com/...')  -> UND_ERR_CONNECT_TIMEOUT
 *   curl  https://api.certspotter.com/...    -> 200 OK
 *
 * Setelah autoSelectFamily dimatikan dan urutan DNS diubah ke ipv4first,
 * semua host di atas bisa dihubungi. Tidak ada downside signifikan untuk
 * panel ini karena tool OSINT tidak butuh koneksi IPv6. Kalau sewaktu-waktu
 * IPv6 menjadi perlu, set OS_FAVOR_IPV6=1 di .env untuk membatalkan.
 */
if (process.env.OS_FAVOR_IPV6 !== '1') {
  try {
    net.setDefaultAutoSelectFamily(false);
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Versi Node lama tidak punya API ini — biarkan perilaku bawaan.
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');

export const envLoaded = fs.existsSync(envFile);

if (envLoaded) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    // Berkas ada tapi rusak — jangan sampe	server gagal start.
    console.warn(
      `[config] .env tidak bisa dibaca (${err.message}). ` +
        'Memakai konfigurasi bawaan. Periksa formatnya.'
    );
  }
}

/** Ringkasan konfigurasi yang terbaca — berguna untuk debugging. */
export function envSummary() {
  const has = (k) => Boolean(process.env[k]);
  return {
    fileFound: envLoaded,
    hibpKey: has('HIBP_API_KEY'),
    metaWaToken: has('META_WA_TOKEN'),
    metaWaPhoneId: has('META_PHONE_NUMBER_ID'),
  };
}