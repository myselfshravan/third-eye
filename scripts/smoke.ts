/**
 * Smoke test the capture engine end-to-end WITHOUT the API/queue/Redis.
 * Captures a URL straight through the browser pool and writes the file.
 *
 *   npm run smoke -- https://example.com
 *   npm run smoke -- https://flutter.dev/showcase  (canvas-app path)
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { capture } from '../src/capture/capture.js';
import { getBrowserPool } from '../src/capture/browserPool.js';

async function main() {
  const url = process.argv[2] ?? 'https://example.com';
  const fullPage = process.argv.includes('--full');
  console.log(`Capturing ${url} (fullPage=${fullPage}) …`);

  const result = await capture({
    url,
    format: 'png',
    fullPage,
    omitBackground: false,
    reducedMotion: true,
    waitStrategy: 'auto',
    delayMs: 0,
    scrollPage: true,
    blockAds: true,
    blockCookieBanners: true,
    pdf: false,
  });

  await mkdir('captures', { recursive: true });
  const out = `captures/smoke.${result.meta.format}`;
  await writeFile(out, result.buffer);

  console.log('✓ captured', {
    out,
    bytes: result.meta.bytes,
    size: `${result.meta.width}x${result.meta.height}`,
    ms: result.meta.durationMs,
    canvasApp: result.meta.isCanvasApp,
    httpStatus: result.meta.httpStatus,
  });

  await getBrowserPool().drain();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ smoke failed:', err);
  process.exit(1);
});
