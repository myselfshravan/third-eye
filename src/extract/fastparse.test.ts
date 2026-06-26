import { describe, it, expect } from 'vitest';
import { extractNextProductObject, nextProductToData } from './nextflight.js';
import { readSignalsFromHtml, parseSignals } from './structured.js';

const BASE = 'https://allensolly.abfrl.in/p/test-39681965.html';

function flightHtml(productJson: string): string {
  // ABFRL ships the product object inside self.__next_f.push([1,"<json-string>"]).
  return `<!doctype html><html><body>
    <script>self.__next_f.push([1,${JSON.stringify('I' + productJson)}])</script>
  </body></html>`;
}

describe('extractNextProductObject (ABFRL Next.js RSC)', () => {
  const product = {
    ProductHierarchy: 'Men/Shirts',
    ProductID: 39681965,
    Name: 'Navy Printed Formal Shirt',
    Color: 'Navy',
    Description: 'A crisp shirt — pair with chinos } for a sharp look',
    Sizes: [
      { Name: 'M', SellingPrice: 999, Price: 1999, Quantity: 3 },
      { Name: 'L', SellingPrice: 999, Price: 1999, Quantity: 0 },
    ],
    Media: { Images: [{ Name: '39681965-25399200', Extension: 'jpg', Position: 1 }] },
    Features: { Brand: 'Allen Solly', Material: 'Cotton' },
  };

  it('recovers the product object from the flight payload', () => {
    const obj = extractNextProductObject(flightHtml(JSON.stringify(product)));
    expect(obj).not.toBeNull();
    expect(obj!.ProductID).toBe(39681965);
    expect(obj!.Name).toBe('Navy Printed Formal Shirt');
  });

  it('survives literal braces inside string values', () => {
    // The description contains a `}` — naive brace matching would corrupt the parse.
    const obj = extractNextProductObject(flightHtml(JSON.stringify(product)));
    expect((obj as Record<string, string>).Description).toContain('}');
  });

  it('maps to normalized fields + builds image URLs from the og host', () => {
    const obj = extractNextProductObject(flightHtml(JSON.stringify(product)))!;
    const d = nextProductToData(obj, 'imagescdn.allensolly.com');
    expect(d.title).toBe('Navy Printed Formal Shirt');
    expect(d.brand).toBe('Allen Solly');
    expect(d.price).toBe(999);
    expect(d.currency).toBe('INR');
    expect(d.color).toBe('Navy');
    expect(d.material).toBe('Cotton');
    expect(d.sizes).toEqual(['M', 'L']);
    expect(d.images).toEqual([
      'https://imagescdn.allensolly.com/img/app/product/3/39681965-25399200.jpg',
    ]);
  });

  it('returns null when there is no flight payload', () => {
    expect(extractNextProductObject('<html><body>no next here</body></html>')).toBeNull();
  });
});

describe('readSignalsFromHtml + parseSignals (plain-HTML structured parse)', () => {
  it('parses JSON-LD Product from raw HTML', () => {
    const html = `<head>
      <script type="application/ld+json">
      {"@type":"Product","name":"Linen Shirt","brand":{"name":"Bluorng"},
       "image":["https://cdn.x.com/a.jpg","https://cdn.x.com/b.jpg"],
       "offers":{"price":"8200","priceCurrency":"INR","availability":"https://schema.org/InStock"}}
      </script></head>`;
    const r = parseSignals(readSignalsFromHtml(html), BASE);
    expect(r.hadJsonLd).toBe(true);
    expect(r.title).toBe('Linen Shirt');
    expect(r.brand).toBe('Bluorng');
    expect(r.price).toBe(8200);
    expect(r.currency).toBe('INR');
    expect(r.availability).toBe('InStock');
    expect(r.images.map((i) => i.url)).toContain('https://cdn.x.com/a.jpg');
  });

  it('falls back to OpenGraph (incl. multiple og:image, reversed attr order)', () => {
    const html = `<head>
      <meta property="og:title" content="OG Tee">
      <meta content="https://cdn.x.com/1.jpg" property="og:image">
      <meta property="og:image" content="https://cdn.x.com/2.jpg">
      <meta property="product:price:amount" content="1499">
      <meta property="product:price:currency" content="INR"></head>`;
    const r = parseSignals(readSignalsFromHtml(html), BASE);
    expect(r.title).toBe('OG Tee');
    expect(r.price).toBe(1499);
    expect(r.images).toHaveLength(2);
  });
});
