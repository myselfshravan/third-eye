# third-eye — agent & contributor guide

A production-grade screenshot / render API. **URL in → image (or PDF/JSON) out.**
Built to capture *any* site reliably, including canvas-based apps
(Flutter/CanvasKit, WebGL, Unity-WASM) that have no DOM.

## What it is
- **API** (Fastify) — validates, authenticates, rate-limits. Serves synchronous
  captures itself and enqueues async/bulk jobs.
- **Worker** (BullMQ) — consumes the queue, runs captures, uploads to storage,
  fires webhooks. Scale horizontally by adding replicas.
- **Capture engine** (Playwright/Chromium) — the shared core both processes use.

## Architecture (one image, two roles)
```
client → API (Fastify) ──sync──→ capture engine (browser pool)
              │ async/bulk
              ▼
            Redis (BullMQ) ──→ Worker(s) → capture engine → R2/S3 → CDN url / webhook
```
The same Docker image runs as `api` or `worker`, selected by `ROLE`.

## Layout
```
src/
  core/        config (env→validated), logger, errors, metrics, schema (the contract)
  capture/     browserPool, capture (orchestrator), readiness (the oracle),
               devices, blocklists
  storage/     R2/S3 upload + presign
  queue/       BullMQ queue + job types
  api/         server, auth, routes/ (screenshot, jobs, bulk, health)
  worker/      BullMQ worker (capture → upload → webhook)
  entrypoints/ api.ts, worker.ts (graceful shutdown, pool warm-up)
scripts/smoke.ts  engine-only end-to-end test (no API/Redis)
```

## The two things that matter most
1. **The readiness oracle** (`src/capture/readiness.ts`) — deciding *when* a page
   is visually done. Layered: navigation lifecycle → networkidle → `fonts.ready`
   → lazy-load scroll → freeze animations → **canvas/Flutter detection + first-
   frame wait**. This is the core value; most capture bugs live here.
2. **The browser pool** (`src/capture/browserPool.ts`) — warm, isolated-per-
   request contexts, recycle-after-N-uses, crash self-heal. Chrome leaks; this is
   what keeps the service alive under load.

## Canvas apps (Flutter/CanvasKit/WebGL) — the hard case
- They paint the whole UI into one `<canvas>` via WebGL; there is **no DOM** to
  wait on. We detect them (`detectCanvasApp`) and use a first-frame/settle wait.
- Headless Chrome needs a **working GL stack** or the canvas is blank. We enable
  software WebGL via SwiftShader launch flags (`BROWSER_ENABLE_WEBGL=true`).
- CDP/Playwright surface capture reads pixels from the compositor, so it works
  even on tainted/cross-origin canvases (unlike in-page `canvas.toDataURL`).

## Conventions
- TypeScript ESM, Node ≥22. Relative imports end in `.js` (NodeNext).
- `src/core/schema.ts` is the single source of truth for request shape — used by
  routes, queue payloads, and the engine. Don't duplicate validation elsewhere.
- All env access goes through `src/core/config.ts` (validated at boot, fail-fast).
- Errors are typed `AppError` (`src/core/errors.ts`) → uniform
  `{ error: { code, message } }` responses.
- Never block the global on a single flaky page: readiness helpers swallow their
  own timeouts; the only hard failure is navigation or the overall capture timeout.

## Common commands
```bash
npm run dev:api          # API with watch (needs Redis for async/rate-limit)
npm run dev:worker       # worker with watch
npm run smoke -- <url>   # capture one URL straight through the engine
npm run smoke -- <url> --full   # full-page
npm run typecheck && npm test && npm run build
docker compose up --build       # full local stack (api + worker + redis)
```

## Tuning / gotchas
- **Memory is the constraint.** Each browser ≈ 150–400MB. `BROWSER_POOL_SIZE` and
  `WORKER_CONCURRENCY` must fit host RAM; `shm_size: 1gb` in Docker is required
  (default 64MB `/dev/shm` crashes Chrome).
- Keep `WORKER_CONCURRENCY ≤ BROWSER_POOL_SIZE`.
- Async results go to R2 (`STORAGE_DRIVER=s3`); with driver=none, results
  inline as base64 in Redis — fine for dev, not for production volume.
- Bot protection (Cloudflare/DataDome) can still block captures → `upstream_blocked`.
  We set a realistic UA and block `navigator.webdriver`-style tells, but this is
  an arms race, not a solved problem.

## Deploy
One Docker image, two roles (`ROLE=api` / `ROLE=worker`). Production target is a
Linux VPS via `docker-compose.prod.yml`, exposed through a **Cloudflare Tunnel**
(`cloudflared` service — TLS + public hostname, no inbound ports). Scale with
`--scale worker=N`. Redis runs in-compose (or point `REDIS_URL` at a managed one);
storage via the pluggable provider (`STORAGE_DRIVER=s3|local|none`). Full runbook
in [DEPLOY.md](DEPLOY.md). **Not** serverless (Vercel/Lambda) — cold starts and no
GL stack break canvas apps.

## Extension points
See [EXTENDING.md](EXTENDING.md). The seams: storage providers
(`src/storage/providers/`, registered by `STORAGE_DRIVER`), device profiles
(`src/capture/devices.ts` + `DEVICE_NAMES`), readiness steps
(`src/capture/readiness.ts`), output encoders (`src/capture/encode.ts`), and
ad/cookie blocklists (`src/capture/blocklists.ts`).
