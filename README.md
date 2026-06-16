# 👁️ third-eye

> **The open-source page-intelligence API.** Screenshot *and* extract product
> images + structured data from any site — even bot-protected ones.
> Self-hosted, free, fast.

[![CI](https://github.com/myselfshravan/third-eye/actions/workflows/ci.yml/badge.svg)](https://github.com/myselfshravan/third-eye/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-43853d.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)
[![Playwright](https://img.shields.io/badge/engine-Patchright%2FChromium-2EAD33.svg)](https://playwright.dev)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Every commercial screenshot API charges $9–$79/mo, throttles you, and **still
gets blocked** by modern bot protection. third-eye is the free, self-hostable
alternative that goes further: point it at a product page and it returns the
**actual product images + structured data** (title, brand, price, sizes), not
just a PNG — purpose-built to feed similar-image search and catalog ingestion.

- 🛡️ **Passes bot detection** — Patchright (patched Chromium) defeats the
  headless/automation tells that block stock Playwright/Puppeteer. Captures
  Shopify, Next.js, SPAs, Uniqlo, and more where rivals 403.
- 🛍️ **Product extraction** — `/v1/extract` pulls product images + data via
  JSON-LD / OpenGraph / Shopify-JSON / DOM heuristics. *Returns the image from
  the URL*, with a screenshot fallback.
- 🧠 **Readiness oracle** — network-idle + `fonts.ready` + lazy-load scroll +
  animation freeze + **canvas/Flutter first-frame detection** (Flutter/WebGL
  apps render, not blank).
- 🖼️ **Screenshots done right** — full-page single-pass (no scroll-stitch
  seams), element clip, device emulation, dark mode, PNG/JPEG/WebP/PDF.
- ♻️ **Warm browser pool** — per-request isolation, recycle-after-N, crash
  self-heal. ⚡ **Sync + async (webhooks) + bulk** via Redis/BullMQ.
- 🔑 API-key auth, per-plan rate limits, Prometheus metrics, graceful shutdown.
- 🧩 **Pluggable** storage (`none`/`s3`/`local`), devices, readiness steps,
  output formats, extractors — see [EXTENDING.md](EXTENDING.md).
- ☁️ One Docker image → any VPS, published via **Cloudflare Tunnel**. **Not**
  serverless (cold starts + no GL stack break the warm pool and canvas apps).

## How it compares

| | third-eye | commercial screenshot APIs |
|---|---|---|
| **Price** | **Free / self-hosted (MIT)** | $9–$79/mo, then per-shot overage |
| **Rate limits** | yours to set | 40–100/min typical |
| **Passes modern bot detection** | ✅ Patchright | ❌ mostly blocked |
| **Product image + data extraction** | ✅ built-in | ❌ none |
| **Canvas/Flutter/WebGL rendering** | ✅ SwiftShader + first-frame wait | ⚠️ often blank |
| **Screenshots / PDF / full-page** | ✅ | ✅ |
| **Data ownership** | 100% yours | vendor-hosted |

*Compared against allscreenshots, pikwy, site-shot, screenshotapi, microlink,
screenshotone, screenshotapi.net, urlbox. Hardest-tier marketplaces behind
Akamai sensor-data / PerimeterX (e.g. H&M, Zara, Myntra) still require
residential proxies — see [Limitations](#limitations).*

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

### 🛍️ Product extraction (the wedge)

Point at a product page (PDP); get the product images + structured data back.

```bash
curl -X POST http://localhost:8080/v1/extract \
  -H 'x-api-key: te_dev_local' -H 'content-type: application/json' \
  -d '{"url":"https://bluorng.com/products/flyway-linen-shirt"}'
```
```jsonc
{
  "title": "Flyway Linen Shirt",
  "brand": "Bluorng",
  "price": 8200, "currency": "INR",
  "sizes": ["XS","S","M","L","XL","XXL"],
  "images": [ { "url": "https://cdn.shopify.com/.../rvet5refd.jpg", "source": "shopify" }, … ],
  "primaryImage": "https://cdn.shopify.com/.../rvet5refd.jpg",
  "confidence": "high",          // high = JSON-LD/Shopify · medium = OG · low = DOM heuristics
  "sources": ["shopify","og"],
  "blocked": false
}
```

Return the **primary product image bytes** directly (screenshot fallback if none):

```bash
curl -X POST 'http://localhost:8080/v1/extract?response=image' \
  -H 'x-api-key: te_dev_local' -H 'content-type: application/json' \
  -d '{"url":"https://www.uniqlo.com/in/en/products/E482443-000/00"}' --output product.jpg
```

Listing (PLP) → every product card; plus async extraction:

```bash
curl -X POST http://localhost:8080/v1/extract/listing -H 'x-api-key: te_dev_local' \
  -H 'content-type: application/json' -d '{"url":"https://bluorng.com/collections/all"}'
curl -X POST http://localhost:8080/v1/extract/async   -H 'x-api-key: te_dev_local' \
  -H 'content-type: application/json' -d '{"url":"...","webhookUrl":"https://you.dev/hook"}'
```

Extraction strategy (precedence): **JSON-LD `Product` → OpenGraph → Shopify
`.json` → DOM gallery heuristics**, normalized to absolute URLs and deduped.

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

Extraction adds `maxImages` and `includeScreenshot`, and inherits the full
capture surface (device, stealth, waits, `proxy`).

## Endpoints
`POST /v1/screenshot` · `GET /v1/screenshot` · `POST /v1/screenshot/async` ·
`POST /v1/extract` · `POST /v1/extract/async` · `POST /v1/extract/listing` ·
`GET /v1/jobs/:id` · `POST /v1/bulk` · `GET /healthz` · `GET /readyz` · `GET /metrics`

## How it works (deep dive)
The interesting engineering and the hard cases (Flutter/CanvasKit, when-is-a-page-
ready, full-page stitching, memory) are documented in [CLAUDE.md](CLAUDE.md).

## Deploy

One Docker image, two roles (`api` + `worker`). Deploys to any Linux box with
Docker. Recommended: **VPS / EC2 + Cloudflare Tunnel** (TLS + public hostname,
zero inbound ports). Runbooks: **[DEPLOY.md](DEPLOY.md)** (any VPS) ·
**[DEPLOY-AWS.md](DEPLOY-AWS.md)** (EC2 + S3, with a one-paste bootstrap script).

```bash
git clone https://github.com/myselfshravan/third-eye.git && cd third-eye
cp .env.production.example .env   # set API_KEYS, TUNNEL_TOKEN, pool sizes
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml up -d --scale worker=3   # scale out
```

- **Storage:** Cloudflare R2 (zero egress) — set `STORAGE_DRIVER=s3` and the
  `S3_*` vars; point `S3_PUBLIC_BASE_URL` at your R2/CDN domain. `local` and
  `none` drivers are also built in (see [EXTENDING.md](EXTENDING.md)).

> Not built for serverless (Vercel/Lambda): cold starts kill the warm-pool
> advantage and there's no GL stack, so Flutter/WebGL pages render blank.

## Testing many URLs at once
Drop URLs into [`examples/test-urls.json`](examples/test-urls.json) and run the
batch runner — captures each straight through the engine and prints a summary:

```bash
npm run batch                       # screenshot each URL → captures/
npm run batch -- --extract          # extract product data/images → *.product.json
npm run batch -- path/to/urls.json  # custom file
```

## Limitations
- **Hardest-tier bot walls.** Sites on Akamai *sensor-data* / PerimeterX /
  DataDome (e.g. H&M, Zara, Myntra) block at the edge on TLS/IP reputation +
  behavioral signals — *before* JS runs — so stealth alone won't pass them.
  third-eye detects this and reports `blocked: true` + `httpStatus` honestly
  rather than returning a fake "success". Cracking these needs residential
  proxies (set `PROXY_URL` / per-request `proxy`) and is a roadmap item. Most
  D2C/Shopify/Next.js storefronts work out of the box.
- **No ML (yet).** Extraction is structured-data + heuristics. A vision-model
  fallback and image embeddings (for direct similar-image search) are planned as
  a pluggable enrichment step.

## Project status
Pre-1.0 and under active development. Capture, **extraction**, stealth, API,
worker, and deploy path are working and tested; see the [CHANGELOG](CHANGELOG.md)
and [open issues](https://github.com/myselfshravan/third-eye/issues).

## Contributing
Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
guidelines, [EXTENDING.md](EXTENDING.md) for how to add storage backends,
devices, readiness steps, or output formats, and [CLAUDE.md](CLAUDE.md) for the
architecture. By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security
Found a vulnerability? Please report it privately — see
[SECURITY.md](SECURITY.md). Note the **SSRF** hardening guidance there before
exposing third-eye publicly (it renders arbitrary user-supplied URLs).

## License
[MIT](LICENSE) © Shravan Revanna
