# Kontribusi

Terima kasih telah ingin berkontribusi pada **Chameleon Console** — alat investigasi OSINT lokal, open source (MIT), tanpa dependensi eksternal.

## Alur branch

Hanya ada dua branch permanen:

| Branch | Fungsi | Aturan |
|---|---|---|
| `main` | Rilis stabil, sumber tag `v*` | **Dilarang push langsung.** Hanya menerima merge dari `dev` lewat PR/MR |
| `dev` | Branch kerja harian | Push langsung boleh; yang dilarang hanya force-push dan penghapusan |

Alur:

```bash
git switch dev
git pull --ff-only

# ... perubahan ...

npm run smoke          # 163 cek, lakukan sebelum push
git add -A
git commit -m "fix: deskripsi singkat"
git push
```

Rilis dilakukan dengan PR/MR **`dev` → `main`**, lalu tag `v*` di `main`.
Tidak ada branch per fitur: semua pekerjaan menumpuk di `dev`.

### Hook pengaman

Repo menyertakan `.githooks/pre-push` yang menolak push langsung ke `main`
(atau `master`). Aktifkan sekali per clone:

```bash
git config core.hooksPath .githooks
```

Hook hanya jaring pengaman lokal (bisa dilewati dengan `--no-verify`).
Proteksi sebenarnya ada di sisi server: *branch protection* GitHub dan
*protected branch* GitLab.

### Fork

Kontributor luar tanpa akses tulis: **Fork** repo, buat branch di fork,
lalu buka PR/MR ke `dev` milik repo utama.

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
