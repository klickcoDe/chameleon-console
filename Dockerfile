# syntax=docker/dockerfile:1
#
# Chameleon Console — OSINT investigation console (Docker)
#
# Build:
#   docker build -t chameleon-console .
#
# Run (development, without .env):
#   docker run --rm -p 3000:3000 chameleon-console
#
# Run (production, with .env mounted):
#   docker run --rm -p 3000:3000 \
#     -v $(pwd)/.env:/app/.env:ro \
#     -v chameleon-data:/app/data \
#     chameleon-console
#
# Compose (recommended):
#   docker compose up

FROM node:20-alpine AS runner

WORKDIR /app

# Proyek ini sengaja zero-dependency (hanya modul bawaan Node),
# jadi tidak ada build step / npm install. Salin semua sumbernya.
COPY server.js package.json README.md ./
COPY src ./src
COPY public ./public

# Direktori data untuk riwayat investigasi & cache OFAC (disingkat di runtime
# melalui volume agar data tidak hilang saat container dihapus).
RUN mkdir -p data/ofac && \
    addgroup -S chameleon && adduser -S chameleon -G chameleon && \
    chown -R chameleon:chameleon /app

USER chameleon

# Default: port 3000, host 0.0.0.0 (wajib di container agar bisa diakses dari luar).
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
