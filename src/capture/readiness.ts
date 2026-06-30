import type { Page } from 'playwright';
import { logger } from '../core/logger.js';

/**
 * The readiness oracle. Capturing pixels is trivial; knowing *when* the page is
 * visually done is the actual hard problem. There is no universal signal, so we
 * layer heuristics. Each helper is best-effort and never throws fatally — a
 * single flaky page must not fail the whole capture.
 */

/** Kill animations/transitions so we never catch a half-finished frame. */
export async function freezeAnimations(page: Page): Promise<void> {
  await page
    .addStyleTag({
      content: `*,*::before,*::after{
        animation-duration:0s !important;
        animation-delay:0s !important;
        transition-duration:0s !important;
        transition-delay:0s !important;
        scroll-behavior:auto !important;
        caret-color:transparent !important;
      }`,
    })
    .catch(() => {});
}

/** Wait for web fonts, or we screenshot fallback fonts (FOUT / reflow). */
export async function waitForFonts(page: Page, timeoutMs = 5_000): Promise<void> {
  await page
    .evaluate(
      (t) =>
        Promise.race([
          (document as Document).fonts?.ready?.then(() => undefined) ??
            Promise.resolve(),
          new Promise<void>((r) => setTimeout(r, t)),
        ]),
      timeoutMs,
    )
    .catch(() => {});
}

/**
 * Scroll the full page to trigger IntersectionObserver / lazy-loaded images,
 * then return to top. We scroll to *load* content; the actual capture is still
 * a single pass (captureBeyondViewport), so there are no stitching seams.
 */
export async function autoScroll(page: Page, stepPx = 600, maxSteps = 60): Promise<void> {
  await page
    .evaluate(
      async ({ step, max }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let last = -1;
        for (let i = 0; i < max; i++) {
          window.scrollBy(0, step);
          await sleep(80);
          const y = window.scrollY;
          const atBottom =
            window.innerHeight + y >=
            document.documentElement.scrollHeight - 2;
          if (atBottom || y === last) break;
          last = y;
        }
        window.scrollTo(0, 0);
        await sleep(120);
      },
      { step: stepPx, max: maxSteps },
    )
    .catch(() => {});
}

/**
 * Detect a canvas-based app (Flutter/CanvasKit, Unity-WASM, WebGL scenes).
 * These render the whole UI into one <canvas> via WebGL — there is no DOM to
 * wait on, so we must treat them specially.
 */
export async function detectCanvasApp(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      // Flutter web markers.
      const flutter =
        document.querySelector('flutter-view, flt-glass-pane, flt-scene-host') !=
          null ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._flutter != null ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).flutterConfiguration != null;
      if (flutter) return true;
      // A large full-bleed canvas that dominates the viewport ⇒ canvas app. The
      // threshold is high (80%) so a decorative/ad canvas doesn't false-positive
      // and trigger the expensive canvas first-frame wait.
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.some((c) => {
        const r = c.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.8 && r.height >= window.innerHeight * 0.8;
      });
    })
    .catch(() => false);
}

/**
 * For canvas apps we cannot query DOM readiness. Instead we poll the canvas for
 * a non-uniform (non-blank) frame, then settle. This catches the common failure
 * where the GL context is up but the first frame hasn't painted.
 */
export async function waitForCanvasReady(
  page: Page,
  { settleMs = 1_200, timeoutMs = 8_000 } = {},
): Promise<void> {
  const start = Date.now();
  // Give the WASM/engine a beat to grab a GL context and schedule a frame.
  await page.waitForTimeout(Math.min(settleMs, timeoutMs));
  // Best-effort: confirm the dominant canvas isn't a single flat colour.
  const painted = await page
    .evaluate(() => {
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'));
      const c = canvases.sort(
        (a, b) =>
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height,
      )[0];
      if (!c) return true; // no canvas → nothing to verify
      try {
        // WebGL canvases can't be read this way (and may be tainted); if so we
        // optimistically assume painted rather than block forever.
        const ctx = c.getContext('2d');
        if (!ctx) return true;
        const { width, height } = c;
        if (!width || !height) return false;
        const data = ctx.getImageData(0, 0, Math.min(width, 64), Math.min(height, 64)).data;
        const first = `${data[0]},${data[1]},${data[2]},${data[3]}`;
        for (let i = 4; i < data.length; i += 4) {
          if (`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}` !== first) {
            return true;
          }
        }
        return false;
      } catch {
        return true; // tainted/WebGL — assume painted
      }
    })
    .catch(() => true);

  if (!painted && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(Math.min(800, timeoutMs - (Date.now() - start)));
  }
  logger.debug({ painted, elapsed: Date.now() - start }, 'canvas readiness');
}
