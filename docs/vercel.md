# Deploy UI ke Vercel, API tetap di container

Arsitektur dua bagian: **UI statis di Vercel** (CDN, gratis) dan **API di
container** (VPS / Fly.io / Railway / Render) yang menjalankan `server.js`
apa adanya.

```
Browser ──► https://chameleon-console.vercel.app   (public/index.html + app.js)
   │
   └── fetch ──► https://api.contoh.com    (server.js di container, CORS)
                      └── data/history.jsonl, cache OFAC, port scan
```

Keuntungan jalur ini: semua fitur tetap utuh — riwayat persisten, cache OFAC,
rate limit per proses, dan port scan — karena backend-nya proses Node biasa,
bukan function.

> **Peringatan urutan deploy.** Jangan deploy UI statis ke produksi sebelum
> backend hidup. Vercel (sejak Juni 2026) otomatis mendeteksi `server.js` di
> root dan menjalankannya sebagai backend. Begitu deploy statis masuk, fungsi
> itu hilang dan `/api/*` akan 404 sampai `CHAMELEON_API_URL` menunjuk ke
> backend yang benar-benar jalan.

---

## 1. Deploy backend dulu

Ikuti [deploy.md](deploy.md) (Docker Compose atau systemd), lalu pastikan:

```ini
# .env di server backend
CONTACT_NAME=Chameleon Console
CONTACT_EMAIL=anda@contoh.com

# Origin UI di Vercel. Boleh lebih dari satu, dipisah koma.
CORS_ORIGIN=https://chameleon-console.vercel.app

# Instance publik: matikan fitur aktif ini.
ENABLE_PORT_SCAN=0

# Wajib bila di belakang reverse proxy (HTTPS).
TRUST_PROXY=1
```

Backend harus punya **HTTPS** (Caddy/Nginx/Cloudflare). UI di `https://`
tidak bisa memanggil API `http://` (mixed content).

Uji dari mana saja:

```bash
curl -fsS https://api.contoh.com/api/health
curl -sS -o /dev/null -D - \
  -H 'Origin: https://chameleon-console.vercel.app' \
  https://api.contoh.com/api/health | grep -i access-control
```

Harapan: `access-control-allow-origin: https://chameleon-console.vercel.app`.

---

## 2. Deploy UI ke Vercel

1. **Add New → Project → Import** repo `chameleon-console`.
2. **Root Directory**: biarkan kosong (root repo) — `vercel.json` sudah
   menunjuk `outputDirectory: public`.
3. **Framework Preset**: *Other*.
4. **Environment Variables**:

   | Nama | Nilai |
   |---|---|
   | `CHAMELEON_API_URL` | `https://api.contoh.com` (tanpa garis miring di akhir) |

5. **Deploy.**

Saat build, `scripts/vercel-config.mjs` menulis `public/config.js` berisi
`apiBase` dari env tersebut. Kalau `CHAMELEON_API_URL` kosong, build
**sengaja gagal** agar UI tidak terlanjur ter-deploy dengan API yang salah.

### Kalau Vercel mendeteksi ini sebagai "Node"

Proyek yang pernah di-deploy tanpa `vercel.json` bisa tersetel **Framework
Preset: Node**, lalu Vercel menjalankan `server.js` sebagai fungsi. Itu bukan
yang diinginkan di jalur ini. Dua hal di repo sudah mengunci mode statis:

- `vercel.json` memakai `"framework": null` → preset **Other** (statis).
- `.vercelignore` mengecualikan `server.js` dan `src/`, sehingga tidak ada
  backend yang bisa terdeteksi.

Periksa hasilnya di **Deployment → Build Logs**: tidak boleh ada `λ` (fungsi).
Kalau masih ada, pastikan `vercel.json` di root ikut terunggah.

Lewat CLI (opsional):

```bash
npm i -g vercel
vercel link
vercel env add CHAMELEON_API_URL production   # tempel URL backend
vercel --prod
```

---

## 3. Daftarkan domain UI di backend

Setelah tahu domain final (dan domain preview), perbarui `CORS_ORIGIN`:

```ini
CORS_ORIGIN=https://chameleon-console.vercel.app,https://chameleon-console-*.vercel.app
```

Pola `chameleon-console-*.vercel.app` mengizinkan preview deployment.
**Jangan** memakai `https://*.vercel.app` — itu mengizinkan semua aplikasi
Vercel milik siapa pun memanggil API Anda dari browser.

Restart backend, lalu muat ulang UI. Badge di kanan atas harus hijau
("server aktif").

---

## 4. Keamanan — baca ini

- **CORS bukan autentikasi.** Ia hanya membatasi browser. Siapa pun tetap bisa
  memanggil API dengan `curl`. Instance publik = siapa pun bisa menjalankan
  investigasi dan menghabiskan kuota API pihak ketiga.
- **Port scan:** `ENABLE_PORT_SCAN=0` sangat disarankan. Tanpa itu, orang lain
  bisa memindai host apa pun lewat server Anda — risiko hukum ada di Anda.
- **Rate limit** 60 req/menit per IP berjalan di memori proses. Cukup untuk
  satu container; naikkan skala berarti limit terbagi per instance.
- **`.env`** tidak pernah ikut ke Vercel (lihat `.vercelignore`); kunci API
  hanya ada di backend.
- **Riwayat investigasi** tetap di `data/history.jsonl` di backend. Lindungi
  dengan permission `600` (systemd unit sudah `UMask=0077`).

---

## 5. Batasan yang perlu diketahui

| Hal | Keterangan |
|---|---|
| Maltego Transform Provider | Arahkan Maltego ke **endpoint backend** (`https://api.contoh.com/api/maltego/transform`), bukan ke UI Vercel. |
| Cold start | Tidak ada — backend proses panjang. Sebaliknya UI Vercel selalu cepat (CDN). |
| Kuota Vercel | Hanya bandwidth statis; tidak ada function yang dipakai. |
| HTTPS | Wajib di backend; kalau tidak, browser memblokir (mixed content). |
| Port 3000 | Tetap loopback di backend (Compose sudah `127.0.0.1`), diteruskan proxy. |

---

## 6. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Badge "server offline", console: `CORS policy` | `CORS_ORIGIN` belum memuat origin UI. Cek header `access-control-allow-origin` dengan `curl -H 'Origin: ...'`. |
| `Mixed Content: blocked` | `CHAMELEON_API_URL` masih `http://`. Pasang TLS di backend. |
| Build Vercel gagal: `CHAMELEON_API_URL belum diisi` | Tambahkan env var, lalu redeploy (env baru butuh build ulang). |
| UI memanggil `https://...vercel.app/api/...` | `public/config.js` tidak terbaca / build script tidak jalan. Pastikan `vercel.json` di root dan `buildCommand` tidak ditimpa di dashboard. |
| 429 dari backend | Rate limit 60 req/menit per IP; tunggu atau naikkan `MAX_HITS` di `server.js`. |
| `ENABLE_PORT_SCAN=0` tapi masih bisa scan | Backend belum di-restart. |

---

## 7. Alternatif: UI + API di satu domain

Kalau tidak butuh CDN Vercel, seluruh aplikasi bisa jalan di container
(lihat [deploy.md](deploy.md)). Hapus `CORS_ORIGIN`; `public/config.js`
yang ada di repo sudah memakai origin yang sama.
