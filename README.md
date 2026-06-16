# third-eye

A production-grade screenshot & render API. **URL in → image / PDF / JSON out.**
Reliably captures *any* website — static, SSR (Next.js), SPAs, and the hard case:
canvas apps with no DOM (**Flutter/CanvasKit, WebGL, Unity-WASM**).

- 🧠 **Readiness oracle** — network-idle + `fonts.ready` + lazy-load scroll +
  animation freeze + **canvas/Flutter first-frame detection**.
- 🖼️ **Full-page** single-pass capture (no scroll-stitch seams), element clip,
  device emulation, dark mode, PNG/JPEG/WebP/PDF.
- ♻️ **Warm browser pool** with per-request isolation, recycle-after-N, crash
  self-heal — the reliability core.
- ⚡ **Sync + async (webhooks) + bulk** (up to 100 URLs), Redis/BullMQ queue.
- 🔑 API-key auth, per-plan Redis-backed rate limits, Prometheus metrics, health
  checks, graceful shutdown.
- ☁️ One Docker image → **Fly.io** or any VPS. Storage on **Cloudflare R2**.

## Quick start (local)

```bash
cp .env.example .env
npm install
npm run browsers:install        # one-time: Chromium + OS deps

# Engine smoke test — no server/Redis needed:
npm run smoke -- https://example.com
npm run smoke -- https://flutter.dev --full   # exercises the canvas path

# Full stack (API + worker + Redis) via Docker:
docker compose up --build
```

## API

Base URL `http://localhost:8080`. Auth via `x-api-key` (dev key:
`te_dev_local`). Add `?response=binary|base64|json` (default `binary`).

### Synchronous

```bash
curl -X POST http://localhost:8080/v1/screenshot \
  -H 'x-api-key: te_dev_local' -H 'content-type: application/json' \
  -d '{"url":"https://example.com","fullPage":true,"format":"png"}' \
  --output shot.png
```

Convenience GET (browser-friendly):

```
GET /v1/screenshot?url=https://example.com&full_page=true&device=iphone-15
```

### Asynchronous (webhook)

```bash
curl -X POST http://localhost:8080/v1/screenshot/async \
  -H 'x-api-key: te_dev_local' -H 'content-type: application/json' \
  -d '{"url":"https://example.com","webhookUrl":"https://you.dev/hook"}'
# → { "jobId": "...", "status": "queued" }

curl http://localhost:8080/v1/jobs/<jobId> -H 'x-api-key: te_dev_local'
```

### Bulk

```bash
curl -X POST http://localhost:8080/v1/bulk \
  -H 'x-api-key: te_dev_local' -H 'content-type: application/json' \
  -d '{"urls":["https://a.com","https://b.com"],"options":{"device":"desktop-hd"}}'
```

### Key options (see [`src/core/schema.ts`](src/core/schema.ts) for the full contract)

| field | type | notes |
|---|---|---|
| `url` | string (required) | target page |
| `format` | `png` \| `jpeg` \| `webp` | default `png` |
| `pdf` | bool | render PDF instead of an image |
| `fullPage` | bool | single-pass full-page capture |
| `selector` / `clip` | string / rect | capture one element or region |
| `device` | e.g. `iphone-15`, `desktop-hd` | preset viewport + DPR + UA |
| `viewport` / `deviceScaleFactor` | rect / number | manual surface |
| `darkMode`, `reducedMotion`, `locale`, `timezone` | | emulation |
| `waitStrategy` | `auto` \| `networkidle` \| `load` \| `domcontentloaded` | default `auto` |
| `waitForSelector` / `waitForFunction` / `delayMs` | | extra readiness gates |
| `blockAds`, `blockCookieBanners`, `hideSelectors`, `removeSelectors` | | clean shots |
| `injectCss` / `injectJs` / `headers` / `cookies` | | page setup / auth |

## Endpoints
`POST /v1/screenshot` · `GET /v1/screenshot` · `POST /v1/screenshot/async` ·
`GET /v1/jobs/:id` · `POST /v1/bulk` · `GET /healthz` · `GET /readyz` · `GET /metrics`

## How it works (deep dive)
The interesting engineering and the hard cases (Flutter/CanvasKit, when-is-a-page-
ready, full-page stitching, memory) are documented in [CLAUDE.md](CLAUDE.md).

## Deploy
- **Fly.io:** `fly deploy` (the `fly.toml` defines `app` + `worker` process
  groups). `fly scale count app=2 worker=4`. Set secrets:
  `fly secrets set REDIS_URL=... API_KEYS=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...`
- **Any VPS (Hetzner/DO):** `docker compose up -d --build`.
- **Storage:** Cloudflare R2 (zero egress) — set `STORAGE_ENABLED=true` and the
  `S3_*` vars; point `S3_PUBLIC_BASE_URL` at your R2/CDN domain.

> Not built for serverless (Vercel/Lambda): cold starts kill the warm-pool
> advantage and there's no GL stack, so Flutter/WebGL pages render blank.

## License
MIT
