# Extending third-eye

third-eye is built around small, well-defined seams. Each extension point is a
single file (or registry entry) you add to — nothing else in the codebase needs
to change. This keeps forks and contributions low-friction.

## 1. Storage backend
**Where:** [`src/storage/providers/`](src/storage/providers/) +
[`src/storage/storage.ts`](src/storage/storage.ts)

Implement the `StorageProvider` interface and register it:

```ts
// src/storage/providers/gcs.ts
import type { StorageProvider, StoredObject } from '../provider.js';

export class GcsStorageProvider implements StorageProvider {
  readonly enabled = true;
  readonly name = 'gcs';
  async put(buffer: Buffer, contentType: string, keyHint: string): Promise<StoredObject> {
    // upload, return { key, url, bytes }
  }
}
```

```ts
// src/storage/storage.ts — add one line to the registry
const BUILDERS = {
  none: () => new NoneStorageProvider(),
  s3: () => new S3StorageProvider(config.storage.s3),
  local: () => new LocalStorageProvider(config.storage.local),
  gcs: () => new GcsStorageProvider(config.storage.gcs), // ← here
};
```

Add the driver name to `STORAGE_DRIVER` in [`src/core/config.ts`](src/core/config.ts)
and any new env vars. Built-in drivers: `none`, `s3` (R2/S3/MinIO/B2), `local`.

## 2. Device profile
**Where:** [`src/core/schema.ts`](src/core/schema.ts) (`DEVICE_NAMES`) +
[`src/capture/devices.ts`](src/capture/devices.ts)

Add the name to `DEVICE_NAMES`, then the profile. **Get DPR right** — it drives
sharpness and final pixel dimensions:

```ts
'pixel-9-pro': { width: 448, height: 992, deviceScaleFactor: 2.625,
                 isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
```

## 3. Readiness step (the oracle)
**Where:** [`src/capture/readiness.ts`](src/capture/readiness.ts), invoked from
the `auto` branch of [`src/capture/capture.ts`](src/capture/capture.ts)

Add a best-effort helper (it must **swallow its own timeout** — never hard-fail
a capture) and call it in the readiness sequence. This is where you'd add e.g.
video-poster waits, web-component upgrade detection, or app-specific signals.

## 4. Output format / encoder
**Where:** [`src/capture/encode.ts`](src/capture/encode.ts) +
[`src/core/schema.ts`](src/core/schema.ts) (`ImageFormatSchema`)

Add the format to the enum and an entry to `TRANSCODERS` (`null` = pass through
the browser's native bytes; a function = transcode via sharp):

```ts
const TRANSCODERS = {
  png: null,
  jpeg: null,
  webp: (buf, q) => sharp(buf).webp({ quality: q ?? 80 }).toBuffer(),
  avif: (buf, q) => sharp(buf).avif({ quality: q ?? 60 }).toBuffer(), // ← here
};
```

## 5. Ad / cookie-banner blocklists
**Where:** [`src/capture/blocklists.ts`](src/capture/blocklists.ts)

Append host fragments to `AD_TRACKER_HOSTS` or selectors to
`COOKIE_BANNER_SELECTORS`. Keep ad-host entries conservative to avoid breaking
page layout.

## 6. API route
**Where:** [`src/api/routes/`](src/api/routes/) + register in
[`src/api/server.ts`](src/api/server.ts)

Routes use the Zod type provider — validate with a schema derived from
[`src/core/schema.ts`](src/core/schema.ts) so the contract stays single-sourced.

## 7. Product extractor
**Where:** [`src/extract/`](src/extract/) +
[`src/extract/extract.ts`](src/extract/extract.ts) (orchestrator)

Each extractor takes the prepared `page` and returns partial product data +
images tagged with an `ImageSource`. The orchestrator merges by precedence
(`SOURCE_RANK`). Add one (e.g. a vendor-specific API, or a vision-model image
ranker) by writing a `src/extract/<name>.ts` that returns `{ images, ...fields }`
and calling it from `extractProduct()`, then giving its `source` a rank. The
similar-image-search **embeddings** enrichment is the intended next extractor:
run it after merge, attach vectors to each `ProductImage`.

## 8. Queue backend
**Where:** [`src/queue/queue.ts`](src/queue/queue.ts)

The async path is BullMQ-on-Redis. To swap it, keep the `getCaptureQueue()` /
job-data shape and back it with a different driver; the worker
([`src/worker/worker.ts`](src/worker/worker.ts)) and routes consume only that
interface.

---

Run the gate before sending a PR: `npm run typecheck && npm run lint && npm test && npm run build`.
See [CONTRIBUTING.md](CONTRIBUTING.md).
