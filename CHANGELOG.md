# Changelog

Semua perubahan penting pada proyek ini dicatat di berkas ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/)
dan proyek ini memakai [Semantic Versioning](https://semver.org/lang/id/).

## [Belum dirilis]

### Ditambahkan

- **Deployment UI terpisah**: UI statis bisa dihosting di Vercel sementara API
  tetap di container. `public/config.js` + `scripts/vercel-config.mjs` mengisi
  `apiBase` dari env `CHAMELEON_API_URL` saat build; `vercel.json` dan
  `.vercelignore` sudah disiapkan.
- **CORS opt-in** lewat `CORS_ORIGIN` (dukungan wildcard subdomain) dan
  penanganan preflight `OPTIONS`, agar UI di domain lain bisa memanggil API.
- **`ENABLE_PORT_SCAN=0`** untuk mematikan satu-satunya fitur aktif pada
  instance publik.
- `docs/vercel.md`: panduan dua platform, keamanan, dan troubleshooting.

### Diubah

- `public/app.js` memakai `apiUrl()` sehingga semua request (termasuk ekspor)
  mengikuti `apiBase`; mode satu domain tetap berjalan tanpa konfigurasi.

## [1.0.0] — 2026-10-28

Rilis publik pertama: **Chameleon Console** — konsol investigasi OSINT lokal,
nol dependensi, dengan 39 tool dan ekspor Maltego.

### Ditambahkan

- **Telepon & identitas**
  - Verifikasi WhatsApp (manual / Meta Cloud API) dan Telegram.
  - Deteksi operator & jenis baris dari metadata prefix offline.
  - Info nomor lengkap: negara, tipe baris, perkiraan area pendaftaran,
    zona waktu, dan jam lokal.
  - Nama & tag kontak dari jejak publik, dengan bukti per tag.
  - Reputasi nomor: skor spam + alasan (StopForumSpam, pola prefix).
  - Sebaran publik nomor (Bing, Google News RSS, Stack Exchange, urlscan).
- **Sosial**
  - Enumerasi username lintas platform (gaya Sherlock/maigret) dengan status
    jujur `blocked` untuk situs yang menolak User-Agent bot.
- **Domain & web**
  - DNS via Google DoH, WHOIS via RDAP, subdomain via Certificate Transparency
    (CertSpotter dengan fallback crt.sh), header keamanan, Wayback, fingerprint.
  - Penilaian posture web: TLS, `security.txt`, `robots.txt`, path terbuka.
  - Profil IP: ASN, reverse DNS, reverse IP, riwayat urlscan.
  - Port scan TCP connect ringan (port umum, concurrency rendah, tanpa banner
    grabbing) — hanya berjalan atas target eksplisit.
- **Intel & forensik**
  - Jejak dompet BTC/ETH dan pencarian CVE (NVD), seluruhnya keyless.
  - Recon ala OSIRIS: BGP/RPKI, vendor MAC, sanksi OFAC dengan cache lokal 24 jam.
  - Forensik lokal: hash, identifikasi hash, dekoder, analisis kata sandi —
    tidak ada data yang dikirim keluar.
- **Ekspor**
  - Maltego Transform Provider (protokol resmi) plus ekspor CSV, clipboard,
    tautan, dan JSON.
- **Antarmuka web** vanilla JS bertema neon, sidebar dibangun dari `/api/tools`.
- **API HTTP** dengan 60 permintaan/menit per IP, batas body 256 KB, dan
  riwayat investigasi JSONL yang diredaksi sebelum ditulis.
- **Deployment** tanpa dependensi: `node server.js`, Docker (`node:20-alpine`,
  non-root, healthcheck), dan Docker Compose dengan volume data.
- **Pengujian** `npm run smoke` — 163 pemeriksaan tanpa butuh server hidup.
- **CI/CD** untuk GitHub Actions dan GitLab CI: cek sintaks, higiene repo,
  smoke test, Secret Detection, dan release otomatis dari tag.
- **Dokumentasi** README, CONTRIBUTING, SECURITY, template issue & merge request.

### Keamanan

- `X-Forwarded-For` tidak lagi dipercaya secara default. Header itu hanya
  dipakai untuk audit dan rate limit bila `TRUST_PROXY=1`, sehingga klien
  tidak bisa memalsukan IP untuk menghindari rate limit.
- `.env` dan seluruh `data/` (riwayat investigasi) diabaikan git sejak awal;
  pipeline CI memverifikasi keduanya tidak pernah ikut ter-commit.

### Diperbaiki

- `DELETE /api/history` memeriksa hasil `clearHistory()` dengan benar
  (sebelumnya mengecek referensi fungsi, sehingga pesan sukses selalu muncul).
- Prefiks IPv4-mapped (`::ffff:1.2.3.4`) dinormalisasi agar kunci rate limit
  dan log audit konsisten.
- Konsistensi versi di seluruh aplikasi: `package.json`, `/api/health`,
  UI, README, dan SECURITY kini memakai `1.0.0`.
- Berbagai salah ketik pada komentar dan dokumentasi.

[1.0.0]: https://github.com/klickcoDe/chameleon-console/releases/tag/v1.0.0
