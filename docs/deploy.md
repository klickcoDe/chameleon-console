# Deploy

Panduan produksi untuk Chameleon Console. Aplikasi ini nol dependensi:
satu-satunya prasyarat adalah **Node.js ≥ 20.12** (atau Docker).

> Ingin UI di CDN Vercel sementara API tetap di container? Lihat
> [vercel.md](vercel.md). Panduan di bawah adalah deployment satu domain
> (UI + API dari server yang sama).

> **Penting:** server bawaan **tidak punya login**. Kalau diakses dari
> internet, wajib ditaruh di belakang reverse proxy dengan autentikasi.
> Lihat [deploy/nginx.conf](../deploy/nginx.conf) atau
> [deploy/Caddyfile](../deploy/Caddyfile).

---

## 1. Sebelum mulai

| Kebutuhan | Keterangan |
|---|---|
| Node.js | ≥ 20.12 (Docker image memakai `node:20-alpine`) |
| `CONTACT_EMAIL` | **Wajib diisi** untuk pemakaian nyata; Nominatim & ip-api memblokir UA tanpa kontak |
| Disk | ~10 MB untuk cache OFAC + riwayat yang tumbuh perlahan |
| Port | `3000` (default), jangan diekspos langsung ke internet |

```bash
cp .env.example .env
# minimal:
#   CONTACT_NAME=Chameleon Console
#   CONTACT_EMAIL=anda@contoh.com
```

---

## 2. Opsi A — Docker Compose (disarankan)

Butuh Docker Engine + Compose ≥ 2.24.

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

Log dan status:

```bash
docker compose logs -f --tail=50
docker inspect --format '{{.State.Health.Status}}' chameleon-console
```

Data persisten ada di volume bernama `chameleon-data` (riwayat + cache OFAC).
`.env` bersifat opsional; tanpa itu aplikasi tetap jalan dengan nilai bawaan.

**Tanpa Compose:**

```bash
docker build -t chameleon-console:1.0.0 .
docker run -d --name chameleon-console \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -v chameleon-data:/app/data \
  --memory 512m --cpus 1 \
  chameleon-console:1.0.0
```

Perhatikan `127.0.0.1:3000` — port hanya terbuka di loopback, bukan ke internet.

---

## 3. Opsi B — systemd (tanpa Docker)

```bash
# 1. User sistem tanpa login
sudo useradd --system --home /opt/chameleon-console \
  --shell /usr/sbin/nologin chameleon

# 2. Salin aplikasi
sudo mkdir -p /opt/chameleon-console
sudo rsync -a --exclude .git --exclude data ./ /opt/chameleon-console/

# 3. Direktori data (hanya pemilik yang boleh membaca)
sudo install -d -o chameleon -g chameleon -m 700 /opt/chameleon-console/data
sudo install -o chameleon -g chameleon -m 600 \
  /opt/chameleon-console/.env.example /opt/chameleon-console/.env
sudo -u chameleon editor /opt/chameleon-console/.env
# Di mesin yang sama dengan reverse proxy, set HOST=127.0.0.1 agar port 3000
# tidak bisa dijangkau langsung dari jaringan.

# 4. Unit systemd
sudo install -m 644 /opt/chameleon-console/deploy/chameleon-console.service \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chameleon-console
systemctl status chameleon-console --no-pager
```

Unit di `deploy/chameleon-console.service` sudah memakai `ProtectSystem=strict`,
`PrivateTmp`, `UMask=0077`, dan hanya mengizinkan tulis ke `data/`.
Sesuaikan `WorkingDirectory` dan path `node` bila berbeda (`which node`).

---

## 4. Reverse proxy + `TRUST_PROXY`

Contoh konfigurasi siap pakai:

- Nginx: [`deploy/nginx.conf`](../deploy/nginx.conf) (Termasuk rate limit, Basic Auth, timeout 180 s)
- Caddy: [`deploy/Caddyfile`](../deploy/Caddyfile) (TLS otomatis)

Setelah proxy aktif, **wajib** menyalakan:

```ini
TRUST_PROXY=1
```

Tanpa itu, `X-Forwarded-For` diabaikan (sesuai desain) sehingga semua request
tercatat dari `127.0.0.1` dan rate limit berlaku untuk seluruh pengguna
sekaligus. Jangan menyalakannya bila server diakses langsung — header itu bisa
dipalsukan.

---

## 5. Verifikasi pasca-deploy

```bash
# 1. Versi & modul
curl -fsS http://127.0.0.1:3000/api/health

# 2. UI
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/

# 3. Endpoint tanpa jaringan (harus 200)
curl -fsS -X POST http://127.0.0.1:3000/api/phone-info \
  -H 'content-type: application/json' \
  -d '{"phone":"08123456789"}'

# 4. Riwayat & izin berkas
sudo ls -l /opt/chameleon-console/data        # history.jsonl harus 600
```

Smoke test penuh (membutuhkan internet, ±2 menit):

```bash
npm run smoke     # harapan: "163 lulus, 0 gagal"
```

---

## 6. Backup & restore

Yang perlu dicadangkan hanya `data/`: `history.jsonl` dan cache OFAC.

**Docker:**

```bash
# backup
docker run --rm -v chameleon-data:/data:ro -v "$PWD":/backup alpine \
  tar czf "/backup/chameleon-$(date +%F).tar.gz" -C /data .

# restore
docker compose down
docker run --rm -v chameleon-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/chameleon-YYYY-MM-DD.tar.gz -C /data'
docker compose up -d
```

**systemd:**

```bash
sudo tar czf "/var/backups/chameleon-$(date +%F).tar.gz" \
  -C /opt/chameleon-console data
```

Riwayat berisi data pribadi target investigasi — perlakukan berkas backup
setara data sensitif (enkripsi bila disimpan di luar host).

---

## 7. Update

```bash
git pull
# Docker
docker compose up -d --build
# systemd
sudo rsync -a --exclude .git --exclude data ./ /opt/chameleon-console/
sudo systemctl restart chameleon-console
```

Tag rilis mengikuti [CHANGELOG.md](../CHANGELOG.md). Rollback Docker:
`docker run ... chameleon-console:<tag-lama>`. Rollback systemd: `git checkout <tag>`
lalu restart.

---

## 8. Checklist go-live

- [ ] `.env` berisi `CONTACT_EMAIL` yang benar.
- [ ] `TRUST_PROXY=1` **hanya** bila di belakang reverse proxy.
- [ ] Port `3000` tidak terbuka di firewall publik (`ufw deny 3000`, security group).
      Compose sudah mengikat ke `127.0.0.1`; untuk systemd set `HOST=127.0.0.1`.
- [ ] Reverse proxy memakai HTTPS + autentikasi.
- [ ] `GET /api/health` mengembalikan `"version": "1.0.0"`.
- [ ] `data/` hanya bisa dibaca user aplikasi (`600` / `700`).
- [ ] Backup `data/` terjadwal.
- [ ] Monitoring memantau `/api/health` (Docker healthcheck sudah aktif).
- [ ] `npm run smoke` hijau di mesin target.

---

## 9. Yang belum disertakan

| Hal | Status |
|---|---|
| Login / manajemen pengguna | Tidak ada — gunakan reverse proxy (Basic Auth / SSO). |
| TLS | Tidak ada — gunakan Caddy/Nginx + Let's Encrypt. |
| Metrik Prometheus / tracing | Tidak ada — healthcheck JSON saja. |
| Multi-tenant / kuota per pengguna | Tidak ada — rate limit 60 req/menit per IP. |
| Antrean job untuk investigasi panjang | Tidak ada — request berjalan sinkron. |
