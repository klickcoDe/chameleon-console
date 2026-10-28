# GitLab — fitur yang dipakai & cara mengaktifkannya

Repositori ini disiapkan untuk memanfaatkan fitur GitLab sepenuhnya, bukan
sekadar sebagai cermin GitHub. Semua berkas konfigurasi sudah ada di repo;
dokumen ini menjelaskan apa yang perlu dinyalakan sekali di UI GitLab.

## 1. CI/CD (`.gitlab-ci.yml`)

Pipeline berjalan otomatis pada push ke `main`, Merge Request, tag `v*`, dan
lewat tombol **Run pipeline** (source: `web`).

| Job | Stage | Isi |
|---|---|---|
| `syntax` | `test` | `node --check` untuk seluruh berkas JS |
| `hygiene` | `test` | gagal bila `.env` atau `data/` ikut ter-commit |
| `smoke` | `test` | `node test/smoke.mjs` (163 cek) + artifact `smoke.log` |
| `secret_detection` | `test` | template resmi GitLab (`Security/Secret-Detection.gitlab-ci.yml`) |
| `release` | `release` | membuat entri Release dari tag `v*` |

Yang perlu diaktifkan:

- **Settings > CI/CD > General pipelines** — pastikan *CI/CD* aktif dan
  runner tersedia (shared runner cukup; image yang dipakai hanya `node:20-alpine`
  dan `release-cli`).
- **Settings > CI/CD > Token Access** — tidak perlu diubah; proyek tidak
  memakai registry atau submodule.

Tidak ada `npm install` di pipeline: proyek ini nol dependensi.

## 2. Cache & artifact

- `smoke` menyimpan `data/ofac/` (6 MB) di cache `ofac-dataset`, sehingga
  unduhan daftar sanksi tidak diulang setiap pipeline.
- Log smoke test selalu diunggah sebagai artifact (7 hari), berguna saat
  pipeline gagal karena jaringan pihak ketiga.

## 3. Release otomatis

Push tag memicu job `release`, yang membuat entri di **Deploy > Releases**
dengan catatan mengarah ke `CHANGELOG.md`.

```bash
git tag -a v1.0.0 -m "Chameleon Console 1.0.0"
git push gitlab v1.0.0
```

## 4. Issues & Merge Requests

Template sudah tersedia dan otomatis muncul sebagai pilihan:

- `.gitlab/issue_templates/Bug.md`
- `.gitlab/issue_templates/Fitur.md`
- `.gitlab/merge_request_templates/Default.md`

Aktifkan **Settings > General > Visibility, project features, permissions**:

- **Issues** — on
- **Merge requests** — on
- **Wiki** — on (opsional, untuk catatan metodologi investigasi)
- **Snippets** — on (opsional, untuk contoh payload/konfigurasi)
- **Repository > Releases** — on

Lalu di **Settings > Merge requests**:

- *Merge method*: **Fast-forward merge** atau *Merge commit* (bebas)
- *Delete source branch after merge*: on
- *Squash commits when merging*: opsional
- *Pipelines must succeed*: **on** (wajib, karena CI adalah gerbang utama)

## 5. Proteksi branch

**Settings > Repository > Protected branches** untuk `main`:

- *Allowed to merge*: Maintainers
- *Allowed to push and merge*: Maintainers (atau Nobody bila semua lewat MR)
- *Allowed to force push*: off

## 6. Mirroring dengan GitHub

**Settings > Repository > Mirroring repositories**:

- **Pull mirror** dari GitHub (jika GitLab dianggap cermin), atau
- **Push mirror** ke GitHub (jika GitHub tetap repo utama), dengan
  *Only mirror protected branches* = on dan *Keep divergent refs* = on.

Jangan mengaktifkan keduanya sekaligus — pilih satu arah agar tidak ada
loop sinkronisasi.

## 7. Badge

README memakai badge pipeline GitLab:

```markdown
[![Pipeline](https://gitlab.com/USER/REPO/badges/main/pipeline.svg)](https://gitlab.com/USER/REPO/-/pipelines)
```

Badge tambahan tersedia di **Settings > General > Badges** (coverage, release,
licence). Ganti `USER/REPO` pada README bila namespace Anda berbeda.

## 8. Keamanan

- **Secret Detection** sudah aktif lewat template. Hasilnya muncul di
  **Secure > Vulnerability report**.
- **Private Vulnerability Reporting**: aktifkan di
  **Settings > General > Visibility, project features, permissions >
  Security** agar peneliti bisa melapor tanpa issue publik.
- **SAST** opsional: tambahkan

  ```yaml
  include:
    - template: Security/SAST.gitlab-ci.yml
  ```

  jika ingin pemindaian statis tambahan. Untuk proyek nol dependensi ini,
  Secret Detection biasanya sudah menangkap risiko yang paling relevan.

## 9. Fitur yang sengaja tidak dipakai

| Fitur | Alasan |
|---|---|
| Container Registry | Image dibangun di mesin pengguna / Docker Hub; repo tidak menyimpan image. |
| Dependency Scanning / License Scanning | Proyek tidak punya dependensi. |
| Auto DevOps | Pipeline sudah ditulis eksplisit dan jauh lebih ringan. |
| GitLab Pages | Dokumentasi sudah terbaca langsung dari README; bisa ditambahkan bila perlu. |
