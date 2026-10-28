# GitHub — checklist halaman repositori

Berkas di repo sudah siap; tinggal mengisi metadata yang tidak bisa disimpan
sebagai file (deskripsi, topik, release). Ganti `USER/REPO` sesuai akun Anda.

## Deskripsi & topik

Lewat UI: **Settings > General > Description** dan **Topics**.

Lewat `gh`:

```bash
gh repo edit USER/REPO \
  --description "Konsol investigasi OSINT lokal: 39 tool, nol dependensi Node.js, ekspor Maltego." \
  --homepage "https://github.com/USER/REPO#readme" \
  --add-topic osint \
  --add-topic maltego \
  --add-topic nodejs \
  --add-topic zero-dependencies \
  --add-topic information-gathering \
  --add-topic investigations \
  --add-topic dns-lookup \
  --add-topic whois \
  --add-topic phone-number \
  --add-topic username-enumeration \
  --add-topic threat-intelligence \
  --add-topic security-tools
```

## Fitur yang sebaiknya dinyalakan

| Fitur | Lokasi | Catatan |
|---|---|---|
| Issues | Settings > General > Features | Template bug/fitur ada di `.gitlab/`; untuk GitHub salin ke `.github/ISSUE_TEMPLATE/` bila mau |
| Discussions | Settings > General > Features | Tempat tanya-jawab metodologi |
| Wiki | Settings > General > Features | Catatan teknis panjang |
| Private vulnerability reporting | Settings > Security | Wajib, rujuk `SECURITY.md` |
| Dependabot alerts | Settings > Security | Tidak ada dependensi, tetap aman diaktifkan |
| Branch protection `main` | Settings > Branches | Wajib lolos CI sebelum merge |
| Releases | Tags | Push tag `v1.0.0`, lalu buat release dari CHANGELOG |

## Release

```bash
git tag -a v1.0.0 -m "Chameleon Console 1.0.0"
git push origin v1.0.0

gh release create v1.0.0 \
  --title "Chameleon Console 1.0.0" \
  --notes-file CHANGELOG.md
```

## Social preview

**Settings > General > Social preview** — unggah `docs/screenshot.png`
(disarankan 1280×640). Ambil ulang tangkapan layar setelah UI berubah:

```bash
node server.js &
firefox --headless --window-size=1440,1000 \
  --screenshot docs/screenshot.png http://127.0.0.1:3000/
```

## Mirror ke GitLab

Lihat [gitlab.md](gitlab.md) bagian *Mirroring dengan GitHub*. Pilih satu arah
saja (pull atau push) agar tidak terjadi loop.
