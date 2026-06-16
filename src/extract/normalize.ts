import type { ProductImage } from './types.js';

/**
 * URL + image normalization shared by every extractor. Real PDPs return
 * relative URLs, protocol-relative URLs, srcset candidate lists, and the same
 * image at many sizes — all of which must be resolved and deduped before the
 * result is useful for similar-image search.
 */

/** Resolve a possibly-relative/protocol-relative URL against the page URL. */
export function absolutize(src: string | undefined | null, base: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s || s.startsWith('data:')) return null;
  try {
    return new URL(s, base).toString();
  } catch {
    return null;
  }
}

/** Pick the highest-resolution candidate from a `srcset` value. */
export function bestFromSrcset(srcset: string | undefined | null, base: string): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    // descriptor is like "640w" or "2x"; weight w by its number, x by *1000.
    const m = desc?.match(/^(\d+(?:\.\d+)?)(w|x)$/);
    const w = m ? Number(m[1]) * (m[2] === 'x' ? 1000 : 1) : 1;
    if (!best || w > best.w) best = { url, w };
  }
  return best ? absolutize(best.url, base) : null;
}

/**
 * A dedupe key that collapses the same image served at different sizes/CDN
 * params. We strip the query string and common size tokens from the path.
 */
export function imageKey(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname.toLowerCase();
    // Strip width/height tokens: _400x, -800x800, /1080/, @2x, _medium, etc.
    path = path
      .replace(/[_-]\d{2,4}x(\d{2,4})?/g, '')
      .replace(/@\dx/g, '')
      .replace(/[_-](small|medium|large|thumb|thumbnail|grande|compact|master)\b/g, '');
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

const ICON_HINT = /(sprite|logo|icon|favicon|placeholder|pixel|blank|loader|spinner|swatch)/i;

/** Heuristic: is this URL plausibly a product photo (not a logo/icon/tracker)? */
export function looksLikeProductImage(url: string): boolean {
  if (!url || url.startsWith('data:')) return false;
  if (ICON_HINT.test(url)) return false;
  if (/\.svg(\?|$)/i.test(url)) return false; // product photos are raster
  return true;
}

/** Dedupe + cap a list of images, preserving first-seen (highest-precedence) order. */
export function dedupeImages(images: ProductImage[], maxImages: number): ProductImage[] {
  const seen = new Set<string>();
  const out: ProductImage[] = [];
  for (const img of images) {
    if (!looksLikeProductImage(img.url)) continue;
    const key = imageKey(img.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= maxImages) break;
  }
  return out;
}
