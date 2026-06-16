import type { Page } from 'playwright';
import type { ProductImage } from './types.js';
import { bestFromSrcset, absolutize, looksLikeProductImage } from './normalize.js';

/**
 * DOM heuristic fallback — used when a site has no usable structured data.
 * We score every rendered image by size, position, and whether it sits in a
 * gallery-like container, then return the top candidates. This is the
 * "works on any site" safety net (lower confidence than structured data).
 */

interface RawImg {
  src: string;
  srcset: string;
  alt: string;
  width: number;
  height: number;
  top: number;
  inGallery: boolean;
}

export async function extractHeuristic(page: Page, base: string, limit: number): Promise<ProductImage[]> {
  const { out, vh } = await page.evaluate(() => {
    const viewH = window.innerHeight || 800;
    const inChrome = (el: Element) =>
      !!el.closest('header,footer,nav,[role="banner"],[role="navigation"]');
    const galleryHint =
      /gallery|carousel|product|media|slider|thumbnail|zoom|main-image|pdp/i;

    const imgs: RawImg[] = [];
    document.querySelectorAll('img').forEach((img) => {
      const r = img.getBoundingClientRect();
      const w = r.width || img.naturalWidth || 0;
      const h = r.height || img.naturalHeight || 0;
      if (w < 150 || h < 150) return; // skip icons/thumbnails
      if (inChrome(img)) return; // skip header/footer/nav imagery
      const ratio = w / h;
      if (ratio > 4 || ratio < 0.2) return; // skip banners/spacers
      const container = img.closest('[class],[id]');
      const inGallery =
        !!img.closest(
          '[class*="gallery" i],[class*="carousel" i],[class*="product" i],[class*="media" i],[id*="product" i]',
        ) || (container ? galleryHint.test(`${container.className} ${container.id}`) : false);
      imgs.push({
        src: img.currentSrc || img.src || img.getAttribute('data-src') || '',
        srcset: img.getAttribute('srcset') || img.getAttribute('data-srcset') || '',
        alt: img.alt || '',
        width: Math.round(w),
        height: Math.round(h),
        top: Math.round(r.top + window.scrollY),
        inGallery,
      });
    });
    return { out: imgs, vh: viewH };
  });

  const scored = out
    .map((o) => {
      const area = o.width * o.height;
      const aboveFold = o.top < vh * 1.5 ? 1.3 : 1;
      const gallery = o.inGallery ? 1.5 : 1;
      return { ...o, score: area * aboveFold * gallery };
    })
    .sort((a, b) => b.score - a.score);

  const images: ProductImage[] = [];
  for (const s of scored) {
    const url = bestFromSrcset(s.srcset, base) ?? absolutize(s.src, base);
    if (!url || !looksLikeProductImage(url)) continue;
    images.push({ url, width: s.width, height: s.height, alt: s.alt || undefined, source: 'dom' });
    if (images.length >= limit) break;
  }
  return images;
}
