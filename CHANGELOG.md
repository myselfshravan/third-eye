# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Extraction: plain-HTTP fast tier before the browser.** Most PDPs server-render
  their data, and a clean HTTP client passes bot-walls that fingerprint/block the
  headless browser. `/v1/extract` now tries a no-browser fetch first — parsing
  **JSON-LD → OpenGraph → Shopify `.json` → Next.js `__next_f` RSC flight** — and
  only falls back to the browser for JS-rendered SPAs. This **unblocks all 7 ABFRL
  brands** (Allen Solly, Van Heusen, Louis Philippe, Peter England, Reebok,
  American Eagle, Simon Carter) with no proxy, and cuts structured-site extraction
  from ~5-10s to ~0.5-1s. (Ported from the fashion-scraper technique.)
- **~10x faster screenshots.** SwiftShader software-WebGL (needed only for
  canvas/Flutter) was taxing *every* capture (full-page bluorng: 15s). Captures
  now use a fast **no-GPU pool** by default and only fall back to the WebGL pool
  when a canvas app is detected (or `webgl: true` is set) — normal-page
  screenshots drop to ~1-2s. Two lazy pools keyed by GL mode in `browserPool.ts`.
- **Faster `auto` waits on heavy sites** — the readiness oracle now starts at
  `DOMContentLoaded` (not full `load`) and **caps the `networkidle` wait**
  (`NETWORKIDLE_CAP_MS`, default 3s) so chatty sites (analytics/chat/long-poll)
  no longer stall to the navigation timeout. Explicit `waitStrategy: "networkidle"`
  still waits fully.

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
