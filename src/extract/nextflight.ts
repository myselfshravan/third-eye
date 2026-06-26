/**
 * Next.js App-Router RSC flight parser — recovers the server-rendered product
 * object that ABFRL storefronts (Allen Solly, Van Heusen, Louis Philippe, Peter
 * England, Reebok, American Eagle, Simon Carter — all `*.abfrl.in`) embed in
 * `self.__next_f.push([1,"…"])` script chunks. A plain HTTP GET returns this in
 * the HTML (no browser, no API auth) — the technique fashion-scraper proves out.
 *
 * Ported from fashion-scraper's core/toolkit/abfrl.py (extract_product_object).
 */

export interface NextProductData {
  title?: string;
  brand?: string;
  description?: string;
  color?: string;
  material?: string;
  price?: number;
  currency?: string;
  sizes?: string[];
  images: string[];
}

const FLIGHT_RE = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;

/** 1 where a char is inside a JSON string literal (incl. quotes), else 0. */
function stringMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      mask[i] = 1;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      mask[i] = 1;
    }
  }
  return mask;
}

function enclosingObjectStart(text: string, index: number, mask: Uint8Array): number | null {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    if (mask[i]) continue;
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return null;
}

function matchingObjectEnd(text: string, start: number, mask: Uint8Array): number | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (mask[i]) continue;
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** Reconstruct the flight payload and return the PDP's product object, or null. */
export function extractNextProductObject(html: string): Record<string, unknown> | null {
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = FLIGHT_RE.exec(html))) {
    try {
      chunks.push(JSON.parse(m[1]!) as string);
    } catch {
      /* skip unparseable chunk */
    }
  }
  const flight = chunks.join('');
  if (!flight) return null;

  const mask = stringMask(flight);
  let best: Record<string, unknown> | null = null;
  const anchor = /"ProductHierarchy"/g;
  let a: RegExpExecArray | null;
  while ((a = anchor.exec(flight))) {
    const start = enclosingObjectStart(flight, a.index, mask);
    if (start === null) continue;
    const end = matchingObjectEnd(flight, start, mask);
    if (end === null) continue;
    try {
      const obj = JSON.parse(flight.slice(start, end + 1)) as Record<string, unknown>;
      if (
        obj &&
        typeof obj === 'object' &&
        'ProductID' in obj &&
        'Sizes' in obj &&
        (best === null || Object.keys(obj).length > Object.keys(best).length)
      ) {
        best = obj;
      }
    } catch {
      /* not a clean object boundary */
    }
  }
  return best;
}

/** Map the raw product object → normalized fields. `imageHost` comes from og:image. */
export function nextProductToData(
  obj: Record<string, unknown>,
  imageHost: string | null,
): NextProductData {
  const features = (obj.Features as Record<string, unknown>) ?? {};
  const sizes = Array.isArray(obj.Sizes) ? (obj.Sizes as Record<string, unknown>[]) : [];

  const sizeNames = sizes
    .map((s) => (typeof s?.Name === 'string' ? s.Name : null))
    .filter((x): x is string => !!x);

  const sellingPrices = sizes
    .map((s) => Number(s?.SellingPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const price = sellingPrices.length ? Math.min(...sellingPrices) : undefined;

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;

  // images: Media.Images[] → https://{host}/img/app/product/{name[0]}/{name}.{ext}
  const images: string[] = [];
  const media = (obj.Media as Record<string, unknown>) ?? {};
  const imgs = Array.isArray(media.Images) ? (media.Images as Record<string, unknown>[]) : [];
  if (imageHost) {
    for (const im of imgs
      .filter((i) => i && typeof i.Name === 'string')
      .sort((x, y) => Number(x.Position ?? 0) - Number(y.Position ?? 0))) {
      const name = String(im.Name);
      const ext = str(im.Extension) ?? 'jpg';
      images.push(`https://${imageHost}/img/app/product/${name[0]}/${name}.${ext}`);
    }
  }

  return {
    title: str(obj.Name),
    brand: str(features.Brand),
    description: str(obj.Description) ?? str(obj.ShortDescription),
    color: str(obj.Color),
    material: str(features.Material) ?? str(features.UpperMaterial) ?? str(features.Fabric),
    price,
    currency: price != null ? 'INR' : undefined,
    sizes: sizeNames.length ? sizeNames : undefined,
    images,
  };
}
