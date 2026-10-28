## Apa yang diubah

<!-- Ringkas perubahan dan alasannya. -->

## Jenis perubahan

- [ ] Perbaikan bug
- [ ] Fitur baru
- [ ] Dokumentasi
- [ ] Refactor / performa
- [ ] Tool atau modul baru

## Modul yang tersentuh

<!-- Contoh: src/modules/osiris.js, server.js -->

## Cara menguji

```bash
node --check server.js
npm run smoke
```

<!-- Tempel ringkasan hasil: "163 lulus, 0 gagal" atau jumlah yang dilewati. -->

## Checklist

- [ ] Tidak menambah dependensi npm (`package.json` tanpa `dependencies`).
- [ ] `node --check` lolos untuk semua berkas yang diubah.
- [ ] `npm run smoke` tetap hijau (kegagalan jaringan boleh "dilewati").
- [ ] Tidak meng-commit `.env`, `data/`, atau data pribadi hasil investigasi.
- [ ] Dokumentasi (`README.md` / `CHANGELOG.md`) diperbarui bila perilaku
      atau API berubah.
- [ ] Tidak mengubah batas etis proyek (hanya data publik, tanpa bypass).

## Catatan untuk reviewer

<!-- Hal yang perlu perhatian khusus, trade-off, atau pertanyaan terbuka. -->

Closes #
