import { config } from '../core/config.js';
import { getBrowserPool } from '../capture/browserPool.js';
import { buildContextOptions, preparePage } from '../capture/capture.js';
import { Errors } from '../core/errors.js';
import type { CaptureOptions } from '../core/schema.js';
import type { ImageSource, ProductData, ProductImage } from './types.js';
import { extractStructured } from './structured.js';
import { extractShopify } from './shopify.js';
import { extractHeuristic } from './heuristics.js';
import { fastExtract } from './fastFetch.js';
import { dedupeImages } from './normalize.js';

/** Image-source precedence for ranking/dedupe (lower = higher trust). */
const SOURCE_RANK: Record<ImageSource, number> = {
  shopify: 0,
  nextflight: 1,
  jsonld: 2,
  og: 3,
  microdata: 4,
  dom: 5,
};

const first = <T>(...vals: (T | undefined)[]): T | undefined => vals.find((v) => v != null);

/**
 * Product extraction orchestrator. Runs structured-data, the Shopify fast-path,
 * and DOM heuristics against one prepared page, then merges by precedence:
 * Shopify/JSON-LD beat OpenGraph/microdata beat DOM heuristics.
 */
export async function extractProduct(opts: CaptureOptions & { maxImages?: number }): Promise<ProductData> {
  const startedAt = Date.now();
  const maxImages = opts.maxImages ?? config.extract.maxImages;

  // ── Fast tier: plain HTTP, no browser ───────────────────────────────────────
  // Most PDPs server-render their data, and a clean HTTP client passes bot-walls
  // that block the headless browser (e.g. ABFRL). ~0.5-1s when it hits.
  // Only short-circuit on HIGH confidence (JSON-LD/Shopify/Next.js RSC = full
  // data). A medium/og-only hit might be a JS-rendered SPA whose gallery only
  // appears in the browser — fall through, but keep `fast` as a floor below.
  const fast = await fastExtract(opts.url, maxImages).catch(() => null);
  if (fast && fast.confidence === 'high' && fast.images.length) return fast;

  // ── Fallback: browser (JS-rendered SPAs, or when the fast tier found nothing) ─
  const pool = getBrowserPool();

  const work = pool.withContext(buildContextOptions(opts), async (context): Promise<ProductData> => {
    const { page, finalUrl, httpStatus, blocked } = await preparePage(context, opts, {
      lightweight: true,
    });

    const structured = await extractStructured(page, finalUrl);
    const shopify = await extractShopify(page, finalUrl);
    // Heuristics are cheap and act as a safety net; always gather, rank last.
    const domImages = await extractHeuristic(page, finalUrl, maxImages).catch(() => []);

    const allImages: ProductImage[] = [...shopify.images, ...structured.images, ...domImages].sort(
      (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
    );
    const images = dedupeImages(allImages, maxImages);

    const sources = [...new Set(images.map((i) => i.source))];
    const confidence: ProductData['confidence'] =
      shopify.matched || structured.hadJsonLd
        ? 'high'
        : sources.some((s) => s === 'og' || s === 'microdata')
          ? 'medium'
          : 'low';

    return {
      url: opts.url,
      finalUrl,
      title: first(shopify.title, structured.title),
      brand: first(shopify.brand, structured.brand),
      description: first(structured.description, shopify.description),
      sku: structured.sku,
      price: first(shopify.price, structured.price),
      currency: first(structured.currency, shopify.currency),
      availability: structured.availability,
      color: structured.color,
      sizes: first(shopify.sizes, structured.sizes),
      images,
      primaryImage: images[0]?.url,
      confidence,
      sources,
      blocked,
      httpStatus,
      durationMs: Date.now() - startedAt,
    };
  });

  // Tight cap for the realtime resolve: the caller blocks on this, so bound the
  // browser fallback hard and lean on the fast-tier floor below rather than a
  // long render. (Screenshots keep the larger browser.captureTimeoutMs.)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(Errors.captureTimeout()), config.extract.captureTimeoutMs),
  );

  const browserResult = await Promise.race([work, timeout]).catch((err) => {
    if (fast) return fast; // browser failed (e.g. blocked) but the fast tier had something
    throw err;
  });
  // Never regress below the fast tier: if the browser found fewer images (e.g. it
  // was blocked, or the SPA didn't yield more), keep the fast result.
  if (fast && fast.images.length > browserResult.images.length) return fast;
  return browserResult;
}
