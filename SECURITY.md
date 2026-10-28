# Kebijakan Keamanan

Chameleon Console adalah alat investigasi OSINT yang membaca **hanya data publik**. Kami tidak menawarkan layanan hosting, jadi keamanan deployment adalah tanggung jawab Anda.

## Versi yang didukung

| Versi | Status |
|-------|--------|
| 2.1.x | ✅ Didukung |

## Melaporkan kerentanan

Jika Anda menemukan masalah keamanan, jangan buat issue publik. Kirim email ke maintainer atau gunakan fitur "Private Vulnerability Reporting" di platform hosting.

## Penting bagi pengguna

- **Port scan** (`/api/port-scan`, bagian `cek-pos`) hanya boleh diarahkan ke sistem milik Anda sendiri atau sistem yang Anda punya izin tertulis untuk mengujinya. Scanning sistem orang lain tanpa izin melanggar hukum di banyak yurisdiksi.
- Alat ini tidak boleh digunakan untuk menyelidiki orang lain tanpa dasar hukum yang jelas.
- Riwayat investigasi disimpan di `data/history.jsonl`. Jangan biarkan data sensitif tersimpan lama-lama di server publik.
- Jika Anda mengekspos instance publik, pertimbangkan autentikasi di depan (reverse proxy dengan Authelia / Cloudflare Access / básic auth) karena server bawaan **tidak memiliki login**.
- Rate limit bawaan: 60 permintaan/menit per IP. Tambahkan WAF / reverse proxy untuk perlindungan lebih lanjut jika dipublikasikan.

## Environment variable rahasia

Jangan pernah commit `.env`. Berkas yang mengandung API key (HIBP, Numverify, Meta WA) harus diabaikan git (sudah di `.gitignore`).
