import { config } from '../core/config.js';
import { getBrowserPool } from '../capture/browserPool.js';
import { buildContextOptions, preparePage } from '../capture/capture.js';
import { Errors } from '../core/errors.js';
import type { CaptureOptions } from '../core/schema.js';
import type { ListingData, ProductCard } from './types.js';
import { absolutize, bestFromSrcset, looksLikeProductImage } from './normalize.js';

/**
 * Listing-page (PLP) extraction: pull every product card from a category/search
 * page. Used for bulk catalog ingestion — the cards feed back into PDP extract.
 * DOM-heuristic based: find the repeated "anchor-to-a-product + image (+ price)"
 * pattern, which is remarkably consistent across storefronts.
 */

interface RawCard {
  url: string;
  src: string;
  srcset: string;
  alt: string;
  priceText: string;
}

const PRODUCT_HREF = /\/(products?|p|pd|dp|item|details|prod)\//i;

export async function extractListing(opts: CaptureOptions & { maxImages?: number }): Promise<ListingData> {
  const startedAt = Date.now();
  const limit = opts.maxImages ?? config.extract.maxImages * 8; // listings hold many
  const pool = getBrowserPool();

  const work = pool.withContext(buildContextOptions(opts), async (context): Promise<ListingData> => {
    const { page, finalUrl, httpStatus, blocked } = await preparePage(context, opts);

    const raw = await page.evaluate(
      ({ hrefPattern }) => {
        const re = new RegExp(hrefPattern, 'i');
        const cards: RawCard[] = [];
        const seen = new Set<string>();
        document.querySelectorAll('a[href]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (!href || !re.test(href) || seen.has(href)) return;
          const img = a.querySelector('img') ?? a.closest('[class],[id]')?.querySelector('img');
          if (!img) return;
          seen.add(href);
          // price text from the card container (nearest sizable ancestor)
          const card = a.closest('li,article,[class*="card" i],[class*="product" i],[class*="item" i]') ?? a;
          const priceMatch = (card.textContent ?? '').match(/(?:[₹$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:USD|INR|EUR|GBP))/);
          cards.push({
            url: href,
            src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || img.getAttribute('data-src') || '',
            srcset: img.getAttribute('srcset') || img.getAttribute('data-srcset') || '',
            alt: (img as HTMLImageElement).alt || '',
            priceText: priceMatch?.[0] ?? '',
          });
        });
        return cards;
      },
      { hrefPattern: PRODUCT_HREF.source },
    );

    const products: ProductCard[] = [];
    const seenUrls = new Set<string>();
    for (const c of raw) {
      const url = absolutize(c.url, finalUrl);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const image = bestFromSrcset(c.srcset, finalUrl) ?? absolutize(c.src, finalUrl) ?? undefined;
      const priceNum = c.priceText ? Number(c.priceText.replace(/[^\d.]/g, '')) : undefined;
      products.push({
        url,
        image: image && looksLikeProductImage(image) ? image : undefined,
        title: c.alt || undefined,
        price: priceNum && !Number.isNaN(priceNum) ? priceNum : undefined,
      });
      if (products.length >= limit) break;
    }

    return {
      url: opts.url,
      finalUrl,
      products,
      count: products.length,
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
