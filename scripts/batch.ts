/**
 * Batch-capture a list of URLs straight through the engine (no API/Redis) and
 * print a summary table. Useful for smoke-testing many sites at once.
 *
 *   npm run batch                       # uses examples/test-urls.json
 *   npm run batch -- path/to/urls.json  # custom file
 *
 * File shape:
 *   {
 *     "defaults": { "fullPage": true, "format": "png" },   // applied to all
 *     "urls": [
 *       "https://example.com",
 *       { "url": "https://site.com", "label": "my-site", "options": { "device": "iphone-15" } }
 *     ]
 *   }
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CaptureOptionsSchema } from '../src/core/schema.js';
import { capture } from '../src/capture/capture.js';
import { extractProduct } from '../src/extract/extract.js';
import { getBrowserPool } from '../src/capture/browserPool.js';

interface Entry {
  url: string;
  label?: string;
  options?: Record<string, unknown>;
}

function slug(s: string): string {
  return s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'examples/test-urls.json';
  const raw = JSON.parse(await readFile(file, 'utf8')) as {
    defaults?: Record<string, unknown>;
    urls: (string | Entry)[];
  };
  const defaults = raw.defaults ?? {};
  const entries: Entry[] = raw.urls.map((u) => (typeof u === 'string' ? { url: u } : u));
  const doExtract = process.argv.includes('--extract');

  await mkdir('captures', { recursive: true });
  console.log(`\n${doExtract ? 'Extracting' : 'Capturing'} ${entries.length} URL(s) from ${file} …\n`);

  const rows: string[] = [];
  for (const [i, entry] of entries.entries()) {
    const label = entry.label ?? slug(entry.url);
    const parsed = CaptureOptionsSchema.safeParse({
      ...defaults,
      ...(entry.options ?? {}),
      url: entry.url,
    });
    if (!parsed.success) {
      rows.push(`✗  ${label.padEnd(28)} INVALID OPTIONS: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    process.stdout.write(`  [${i + 1}/${entries.length}] ${label}\r`);
    try {
      if (doExtract) {
        const p = await extractProduct(parsed.data);
        const price = p.price != null ? `${p.currency ?? ''}${p.price}` : '—';
        const flag = p.blocked ? '⚠blocked' : p.confidence;
        rows.push(
          `${p.images.length ? '✓' : '✗'}  ${label.padEnd(24)} imgs=${String(p.images.length).padStart(2)}  ${String(price).padStart(8)}  [${flag}]  ${(p.title ?? '').slice(0, 32)}`,
        );
        await writeFile(`captures/${label}.product.json`, JSON.stringify(p, null, 2));
      } else {
        const r = await capture(parsed.data);
        const out = `captures/${label}.${r.meta.format}`;
        await writeFile(out, r.buffer);
        const flag = r.meta.httpStatus && r.meta.httpStatus >= 400 ? `⚠ HTTP ${r.meta.httpStatus}` : 'ok';
        rows.push(
          `${flag === 'ok' ? '✓' : '⚠'}  ${label.padEnd(28)} ${String(r.meta.width) + 'x' + r.meta.height}`.padEnd(50) +
            ` ${String(r.meta.durationMs).padStart(6)}ms  ${flag}${r.meta.isCanvasApp ? '  [canvas]' : ''}  → ${out}`,
        );
      }
    } catch (err) {
      rows.push(`✗  ${label.padEnd(28)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n\n──────────────────────────── results ────────────────────────────');
  rows.forEach((r) => console.log(r));
  console.log('──────────────────────────────────────────────────────────────────\n');

  await getBrowserPool().drain();
  process.exit(0);
}

main().catch((err) => {
  console.error('batch failed:', err);
  process.exit(1);
});
