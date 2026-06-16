# Deploying third-eye to a VPS (Docker + Cloudflare Tunnel)

Production deploy onto a single Linux box, published via Cloudflare Tunnel — no
inbound ports, TLS handled by Cloudflare. Scale by adding worker replicas.

## 0. Prerequisites
- A Linux VPS (≥2 vCPU, ≥4GB RAM recommended for browser workloads).
- A domain on Cloudflare (for the tunnel hostname).
- SSH access to the box.

## 1. Install Docker on the box (if missing)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker   # run docker without sudo
docker --version && docker compose version
```

## 2. Get the code
```bash
git clone https://github.com/myselfshravan/third-eye.git
cd third-eye
```

## 3. Create the Cloudflare Tunnel
In the Cloudflare dashboard → **Zero Trust → Networks → Tunnels**:
1. **Create a tunnel** (type: *Cloudflared*). Copy the **token**.
2. Add a **Public Hostname**: e.g. `shots.yourdomain.com` →
   **Service:** `HTTP` `api:8080`.
   (The `cloudflared` container shares the compose network, so `api:8080`
   resolves to the API service.)

## 4. Configure env
```bash
cp .env.production.example .env
# Edit .env:
#   - API_KEYS   → openssl rand -hex 24  (use te_live_<hex>:unlimited)
#   - TUNNEL_TOKEN → the token from step 3
#   - tune BROWSER_POOL_SIZE / WORKER_CONCURRENCY to the box
nano .env
```

## 5. Launch
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api worker
```
First build pulls the Playwright base image (~2GB) — give it a few minutes.

## 6. Verify
```bash
# On the box (API is bound to loopback):
curl -s http://127.0.0.1:8080/healthz
curl -s -X POST http://127.0.0.1:8080/v1/screenshot \
  -H "x-api-key: <your key>" -H 'content-type: application/json' \
  -d '{"url":"https://example.com","fullPage":true}' --output /tmp/shot.png && file /tmp/shot.png

# Publicly, via the tunnel:
curl -s https://shots.yourdomain.com/healthz
```

## 7. Operate
```bash
# Scale workers up/down (no API downtime):
docker compose -f docker-compose.prod.yml up -d --scale worker=3

# Update to latest:
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Logs / restart:
docker compose -f docker-compose.prod.yml logs -f --tail=100
docker compose -f docker-compose.prod.yml restart api

# Metrics (Prometheus): http://127.0.0.1:8080/metrics
```

## Tuning & gotchas
- **RAM is the ceiling.** Each browser ≈ 150–400MB. Keep
  `WORKER_CONCURRENCY ≤ BROWSER_POOL_SIZE`; both the `api` and each `worker`
  container hold their own pool.
- `shm_size: 1gb` is set in compose — required, or Chrome crashes on big pages.
- Enable **R2 storage** (`STORAGE_DRIVER=s3` + `S3_*`) before driving real
  async/bulk volume, so results don't pile up as base64 in Redis.
- Bot-protected targets (Cloudflare/Akamai/DataDome) may still return 403; the
  capture reports `httpStatus` in its metadata so you can detect it.
