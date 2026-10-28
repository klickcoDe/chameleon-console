# Kontribusi

Terima kasih telah ingin berkontribusi pada **Chameleon Console** — alat investigasi OSINT lokal, open source (MIT), tanpa dependensi eksternal.

## Cara berkontribusi

1. **Fork** repositori ini.
2. Buat branch fitur: `git checkout -b fitur/nama-fitur`
3. Lakukan perubahan, lalu uji dengan `npm run smoke`.
4. Commit dengan pesan yang jelas (bahasa Indonesia atau Inggris).
5. Push branch dan buat **Pull Request**.

## Standar kode

- Tidak ada dependensi npm — gunakan hanya modul bawaan Node.js (`node:`).
- Komentar dalam bahasa Indonesia.
- Setiap modul baru di `src/modules/` harus mengekspor fungsi utama + daftar `*Tools` untuk registry sidebar (`/api/tools`).
- Jangan mengarang data hasil investigasi; setiap status harus dapat dibuktikan dari sumbernya.

## Pengujian

```bash
npm run smoke
```

## Issue

Laporkan bug atau sampaikan fitur baru melalui [Issues](https://github.com/). Sebutkan versi Node.js dan langkah reproduksi.

## Lisensi

Dengan berkontribusi, Anda setuju bahwa kontribusi Anda dilisensikan di bawah [MIT License](LICENSE).
