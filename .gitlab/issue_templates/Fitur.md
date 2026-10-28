# Usulan Fitur

## Masalah yang ingin diselesaikan

<!--
Jelaskan kebutuhan, bukan langsung solusinya. Contoh:
"Saat memeriksa nomor Indonesia, saya tidak bisa membedakan operator lama
setelah porting, sehingga label operator di laporan bisa menyesatkan."
-->

## Usulan solusi

<!-- Bagaimana menurut Anda fitur ini sebaiknya bekerja. -->

## Alternatif yang sudah dicoba

<!-- Termasuk tool/API lain, dan kenapa kurang cocok. -->

## Kriteria selesai

- [ ]
- [ ]

## Batasan yang perlu dijaga

Chameleon Console sengaja punya batas etis & teknis. Usulan yang melanggar
salah satu poin di bawah kemungkinan besar tidak akan diterima:

- [ ] Tidak menambah dependensi npm (hanya modul bawaan `node:`).
- [ ] Hanya membaca data publik — tanpa login, bypass, atau scraping situs
      yang melarangnya (Truecaller/GetContact/Kredibel, dsb).
- [ ] Tidak mengarang hasil: sumber tidak tersedia → status `unreachable` /
      `unconfigured`.
- [ ] Tidak menambah pemindaian aktif yang berjalan otomatis tanpa target
      eksplisit dari pengguna.
- [ ] Setiap tool baru mengekspor daftar `*Tools` agar muncul di sidebar
      (`/api/tools`).

## Konteks tambahan

<!-- Referensi, tautan API resmi, contoh output dari tool lain. -->
