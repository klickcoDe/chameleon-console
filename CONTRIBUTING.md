# Kontribusi

Terima kasih telah ingin berkontribusi pada **Chameleon Console** — alat investigasi OSINT lokal, open source (MIT), tanpa dependensi eksternal.

## Cara berkontribusi

1. **Fork** repositori ini (GitHub atau GitLab).
2. Buat branch fitur: `git checkout -b fitur/nama-fitur`
3. Lakukan perubahan, lalu uji dengan `npm run smoke`.
4. Commit dengan pesan yang jelas (bahasa Indonesia atau Inggris).
5. Push branch, lalu buka **Pull Request** (GitHub) atau **Merge Request** (GitLab).

Template issue dan merge request sudah tersedia di `.gitlab/` bila Anda
memakai GitLab — cukup pilih template saat membuat issue/MR agar laporan
lengkap sejak awal.

## Standar kode

- Tidak ada dependensi npm — gunakan hanya modul bawaan Node.js (`node:`).
- Komentar dalam bahasa Indonesia.
- Setiap modul baru di `src/modules/` harus mengekspor fungsi utama + daftar `*Tools` untuk registry sidebar (`/api/tools`).
- Jangan mengarang data hasil investigasi; setiap status harus dapat dibuktikan dari sumbernya.
- Jangan menambah pemindaian aktif yang berjalan otomatis tanpa target eksplisit dari pengguna.

## Pengujian

```bash
node --check server.js            # cepat, tanpa jaringan
npm run smoke                     # 163 cek; kegagalan jaringan ditandai "dilewati"
```

Kedua perintah yang sama dijalankan oleh CI di GitHub Actions dan GitLab CI,
jadi pipeline akan menolak kontribusi yang gagal di sini.

## Issue

Laporkan bug atau sampaikan fitur baru melalui Issues di
[GitHub](https://github.com/klickcoDe/chameleon-console/issues) atau
[GitLab](https://gitlab.com/klickcoDe/chameleon-console/-/issues). Sebutkan
versi Node.js, versi Chameleon Console (`/api/health`), dan langkah reproduksi.

**Jangan** melaporkan kerentanan keamanan lewat issue publik — ikuti
[SECURITY.md](SECURITY.md).

## Lisensi

Dengan berkontribusi, Anda setuju bahwa kontribusi Anda dilisensikan di bawah [MIT License](LICENSE).
