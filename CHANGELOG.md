# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`GET /v1/og`** — ultra-low-latency `og:image` lookup. No browser on the happy
  path (streamed HTTP fetch with early-abort once og:image is found), in-memory +
  CDN caching, and a browser fallback for blocked/no-og sites. ~150–500ms typical
  vs seconds for a full render; cached repeats ~0ms.
- **Product extraction** (`/v1/extract`, `/v1/extract/async`,
  `/v1/extract/listing`) — returns product images + structured data (title,
  brand, price, sizes) from a PDP, or every product card from a PLP. Strategy:
  JSON-LD `Product` → OpenGraph → Shopify `.json` → DOM gallery heuristics,
  normalized to absolute URLs and deduped. `?response=image` returns the primary
  product image bytes (screenshot fallback). Verified on Shopify, JSON-LD, and
  OpenGraph storefronts.
- **Bot-detection moat** — Patchright (patched Chromium) via a stealth engine
  seam (`STEALTH`, `BROWSER_CHANNEL`); optional egress proxy (`PROXY_URL` /
  per-request `proxy`); honest bot-wall detection (`blocked` flag, opt-in
  `failOnBlock`).

### Added (initial)
- Capture engine on Playwright/Chromium with a warm, crash-healing browser pool
  (per-request context isolation, recycle-after-N-uses).
- Readiness oracle: networkidle, `fonts.ready`, lazy-load scroll, animation
  freeze, and **canvas/Flutter first-frame detection** (SwiftShader WebGL).
- Full-page single-pass capture, element/clip capture, device emulation, dark
  mode, PNG/JPEG/WebP and PDF output.
- Fastify API: synchronous `/v1/screenshot` (+ convenience GET), async with
  webhooks, bulk (up to 100 URLs), job status — API-key auth, Redis-backed
  per-plan rate limits, Prometheus `/metrics`, health/readiness, graceful
  shutdown.
- BullMQ worker + Redis queue; pluggable storage providers (`none`/`s3`/`local`)
  selected by `STORAGE_DRIVER`.
- Dockerfile (Playwright base image), `docker-compose.yml` (dev) and
  `docker-compose.prod.yml` (VPS + Cloudflare Tunnel), CI workflow.
- `npm run smoke` and `npm run batch` engine-only test runners.
- Open-source scaffolding: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
  EXTENDING, issue/PR templates, Dependabot.

[Unreleased]: https://github.com/myselfshravan/third-eye/commits/main
