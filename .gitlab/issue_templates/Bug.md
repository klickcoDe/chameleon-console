# Laporan Bug

Terima kasih sudah meluangkan waktu. Isi bagian di bawah agar bug bisa
direproduksi tanpa banyak tanya-jawab.

> ⚠️ **Jangan** laporkan kerentanan keamanan lewat issue publik. Ikuti
> [SECURITY.md](../../SECURITY.md) dan gunakan *Private Vulnerability Reporting*
> (GitLab: Security > Vulnerability Report > Report vulnerability).

## Ringkasan

<!-- Satu kalimat: apa yang salah dan di mana. -->

## Langkah reproduksi

1.
2.
3.

## Hasil yang diharapkan

<!-- Apa yang seharusnya terjadi. -->

## Hasil yang didapat

<!-- Salin pesan error / respons JSON apa adanya. -->

```
(tempel di sini)
```

## Lingkungan

| Item | Nilai |
|---|---|
| Versi Chameleon Console | <!-- output `/api/health` -> version --> |
| Node.js | <!-- node -v --> |
| OS / arsitektur | |
| Cara menjalankan | `node server.js` / Docker / Compose |
| Di belakang reverse proxy? | ya (sebutkan) / tidak |
| `TRUST_PROXY` | tidak diset / `1` |

## Modul terkait

<!-- Centang yang relevan -->

- [ ] Telepon / WhatsApp / Telegram (`src/modules/phone.js`)
- [ ] Info nomor & area (`phoneinfo.js`)
- [ ] Nama & tag kontak (`contacts.js`)
- [ ] Reputasi (`reputation.js`)
- [ ] Sebaran publik / mention (`mentions.js`)
- [ ] Sosial / enumerasi username (`social.js`)
- [ ] Domain & DNS (`domain.js`)
- [ ] Jaringan / IP (`network.js`)
- [ ] Port scan (`portscan.js`)
- [ ] Keamanan web (`websec.js`)
- [ ] Forensik (`util/crypto.js`)
- [ ] Intelijen ancaman (`threatintel.js`)
- [ ] OSIRIS / OFAC (`osiris.js`)
- [ ] Maltego (`maltego.js`)
- [ ] UI (`public/`)
- [ ] Server / API (`server.js`)
- [ ] Lainnya:

## Log / keluaran tambahan

<!-- Log server, hasil `npm run smoke`, atau screenshot. Sensor data pribadi. -->

```text
(tempel di sini)
```

## Checklist

- [ ] Sudah mencari issue serupa.
- [ ] Sudah mencoba `npm run smoke` dan menyalin ringkasannya.
- [ ] Tidak menyertakan data pribadi orang lain (nomor, email, alamat) tanpa
      keperluan.
