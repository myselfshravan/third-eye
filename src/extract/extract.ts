import { config } from '../core/config.js';
import { getBrowserPool } from '../capture/browserPool.js';
import { buildContextOptions, preparePage } from '../capture/capture.js';
import { Errors } from '../core/errors.js';
import type { CaptureOptions } from '../core/schema.js';
import type { ImageSource, ProductData, ProductImage } from './types.js';
import { extractStructured } from './structured.js';
import { extractShopify } from './shopify.js';
import { extractHeuristic } from './heuristics.js';
import { dedupeImages } from './normalize.js';

/** Image-source precedence for ranking/dedupe (lower = higher trust). */
const SOURCE_RANK: Record<ImageSource, number> = {
  shopify: 0,
  jsonld: 1,
  og: 2,
  microdata: 3,
  dom: 4,
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
  const pool = getBrowserPool();

  const work = pool.withContext(buildContextOptions(opts), async (context): Promise<ProductData> => {
    const { page, finalUrl, httpStatus, blocked } = await preparePage(context, opts);

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

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(Errors.captureTimeout()), config.browser.captureTimeoutMs),
  );

  return Promise.race([work, timeout]);
}
