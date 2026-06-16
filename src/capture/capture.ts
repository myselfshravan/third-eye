import type { BrowserContext, Page, Route } from 'playwright';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { Errors } from '../core/errors.js';
import type { CaptureOptions, CaptureResult } from '../core/schema.js';
import { getBrowserPool } from './browserPool.js';
import { DEVICES } from './devices.js';
import { AD_TRACKER_HOSTS, COOKIE_BANNER_SELECTORS } from './blocklists.js';
import { contentTypeFor, encodeImage } from './encode.js';
import {
  autoScroll,
  detectCanvasApp,
  freezeAnimations,
  waitForCanvasReady,
  waitForFonts,
} from './readiness.js';
import { detectBlock } from './block.js';

/** Resolve the rendering surface (device profile → explicit viewport → default). */
function resolveSurface(opts: CaptureOptions) {
  if (opts.device) {
    const d = DEVICES[opts.device];
    return {
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: opts.deviceScaleFactor ?? d.deviceScaleFactor,
      isMobile: opts.isMobile ?? d.isMobile,
      hasTouch: opts.hasTouch ?? d.hasTouch,
      userAgent: opts.userAgent ?? d.userAgent,
    };
  }
  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  return {
    viewport,
    deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    isMobile: opts.isMobile ?? false,
    hasTouch: opts.hasTouch ?? false,
    userAgent: opts.userAgent,
  };
}

/** Block ad/tracker/analytics requests — faster, cleaner, cheaper captures. */
async function installAdBlocker(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route: Route) => {
    const url = route.request().url();
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return void route.continue();
    }
    if (AD_TRACKER_HOSTS.some((frag) => host.includes(frag))) {
      return void route.abort();
    }
    return void route.continue();
  });
}

async function applyPageManipulation(page: Page, opts: CaptureOptions): Promise<void> {
  if (opts.reducedMotion) await freezeAnimations(page);

  if (opts.blockCookieBanners) {
    await page
      .addStyleTag({
        content: `${COOKIE_BANNER_SELECTORS.join(',')}{display:none !important;visibility:hidden !important;}
        html.cookie-locked,body.cookie-locked{overflow:auto !important;}`,
      })
      .catch(() => {});
  }
  if (opts.hideSelectors?.length) {
    await page
      .addStyleTag({ content: `${opts.hideSelectors.join(',')}{visibility:hidden !important;}` })
      .catch(() => {});
  }
  if (opts.removeSelectors?.length) {
    await page
      .evaluate(
        (sels) => sels.forEach((s) => document.querySelectorAll(s).forEach((el) => el.remove())),
        opts.removeSelectors,
      )
      .catch(() => {});
  }
  if (opts.injectCss) {
    await page.addStyleTag({ content: opts.injectCss }).catch(() => {});
  }
  if (opts.injectJs) {
    await page.evaluate((js) => {
      new Function(js)();
    }, opts.injectJs).catch(() => {});
  }
}

/** Map our wait strategy onto Playwright's navigation lifecycle. */
function navWaitUntil(opts: CaptureOptions): 'load' | 'domcontentloaded' | 'networkidle' {
  switch (opts.waitStrategy) {
    case 'domcontentloaded':
      return 'domcontentloaded';
    case 'networkidle':
      return 'networkidle';
    case 'load':
      return 'load';
    case 'auto':
    default:
      return 'load';
  }
}

/** Build the per-request browser context options (surface + locale + proxy). */
export function buildContextOptions(opts: CaptureOptions) {
  const surface = resolveSurface(opts);
  return {
    viewport: surface.viewport,
    deviceScaleFactor: surface.deviceScaleFactor,
    isMobile: surface.isMobile,
    hasTouch: surface.hasTouch,
    userAgent: surface.userAgent,
    locale: opts.locale,
    timezoneId: opts.timezone,
    colorScheme: (opts.darkMode ? 'dark' : 'light') as 'dark' | 'light',
    reducedMotion: (opts.reducedMotion ? 'reduce' : 'no-preference') as 'reduce' | 'no-preference',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: opts.headers,
    serviceWorkers: 'block' as const,
    ...(opts.proxy ? { proxy: { server: opts.proxy } } : {}),
  };
}

export interface PreparedPage {
  page: Page;
  finalUrl: string;
  httpStatus: number | null;
  isCanvasApp: boolean;
  blocked: boolean;
}

/**
 * Navigate → run the readiness oracle → manipulate the page → detect bot-walls.
 * The shared front half of every operation; `capture()` and the extractor both
 * build on the page it returns.
 */
export async function preparePage(context: BrowserContext, opts: CaptureOptions): Promise<PreparedPage> {
  context.setDefaultNavigationTimeout(config.browser.navTimeoutMs);
  context.setDefaultTimeout(config.browser.navTimeoutMs);

  if (opts.blockAds) await installAdBlocker(context);
  if (opts.cookies?.length) {
    await context.addCookies(
      opts.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        url: c.domain ? undefined : opts.url,
        domain: c.domain,
        path: c.path ?? '/',
      })),
    );
  }

  const page = await context.newPage();

  let httpStatus: number | null = null;
  try {
    const resp = await page.goto(opts.url, { waitUntil: navWaitUntil(opts) });
    httpStatus = resp?.status() ?? null;
  } catch (err) {
    throw Errors.navigationFailed(`Failed to load ${opts.url}`, String(err));
  }

  if (opts.waitStrategy === 'auto' || opts.waitStrategy === 'networkidle') {
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const isCanvasApp = await detectCanvasApp(page);

  if (opts.waitStrategy === 'auto') {
    await waitForFonts(page);
    if (opts.scrollPage && !opts.selector && !opts.clip) await autoScroll(page);
    if (isCanvasApp) await waitForCanvasReady(page);
  }

  if (opts.waitForSelector) {
    await page
      .waitForSelector(opts.waitForSelector, { state: 'visible' })
      .catch(() => logger.warn({ sel: opts.waitForSelector }, 'waitForSelector timed out'));
  }
  if (opts.waitForFunction) {
    await page
      .waitForFunction(opts.waitForFunction)
      .catch(() => logger.warn('waitForFunction timed out'));
  }

  await applyPageManipulation(page, opts);

  if (opts.delayMs) await page.waitForTimeout(Math.min(opts.delayMs, 15_000));

  const finalUrl = page.url();

  // Detect a bot-wall / challenge. Non-fatal by default (we still return the
  // capture, flagged); hard-fail only if the caller opted in.
  const blocked = await detectBlock(page, httpStatus);
  if (blocked) {
    logger.warn({ url: opts.url, httpStatus }, 'bot-wall / challenge detected');
    if (opts.failOnBlock) throw Errors.upstreamBlocked();
  }

  return { page, finalUrl, httpStatus, isCanvasApp, blocked };
}

/**
 * The capture orchestrator: context → prepare page → pixels. Wrapped in a hard
 * overall timeout so a pathological page can never pin a pooled browser.
 */
export async function capture(opts: CaptureOptions): Promise<CaptureResult> {
  const startedAt = Date.now();
  const pool = getBrowserPool();

  const work = pool.withContext(
    buildContextOptions(opts),
    async (context): Promise<CaptureResult> => {
      const { page, finalUrl, httpStatus, isCanvasApp, blocked } = await preparePage(context, opts);

      // ── PDF path ──────────────────────────────────────────────────────────
      if (opts.pdf) {
        const buffer = await page.pdf({ printBackground: true, preferCSSPageSize: true });
        return {
          buffer,
          contentType: contentTypeFor('pdf'),
          meta: {
            url: opts.url,
            finalUrl,
            width: 0,
            height: 0,
            format: 'pdf',
            bytes: buffer.length,
            durationMs: Date.now() - startedAt,
            isCanvasApp,
            httpStatus,
            blocked,
          },
        };
      }

      // ── Image path ──────────────────────────────────────────────────────
      // Playwright captures png/jpeg natively (single-pass, captureBeyondViewport
      // for fullPage — no scroll-stitch seams). webp is transcoded after.
      const nativeType: 'png' | 'jpeg' = opts.format === 'jpeg' ? 'jpeg' : 'png';
      const shotOpts = {
        type: nativeType,
        quality: nativeType === 'jpeg' ? (opts.quality ?? 80) : undefined,
        omitBackground: opts.omitBackground && opts.format !== 'jpeg',
      } as const;

      let raw: Buffer;
      if (opts.selector) {
        const locator = page.locator(opts.selector).first();
        await locator.waitFor({ state: 'visible' }).catch(() => {});
        raw = await locator.screenshot(shotOpts);
      } else if (opts.clip) {
        raw = await page.screenshot({ ...shotOpts, clip: opts.clip });
      } else {
        raw = await page.screenshot({ ...shotOpts, fullPage: opts.fullPage });
      }

      const { out, width, height } = await encodeImage(raw, opts.format, opts.quality);

      return {
        buffer: out,
        contentType: contentTypeFor(opts.format),
        meta: {
          url: opts.url,
          finalUrl,
          width,
          height,
          format: opts.format,
          bytes: out.length,
          durationMs: Date.now() - startedAt,
          isCanvasApp,
          httpStatus,
          blocked,
        },
      };
    },
  );

  // Hard overall guard independent of Playwright's internal timeouts.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(Errors.captureTimeout()), config.browser.captureTimeoutMs),
  );

  return Promise.race([work, timeout]);
}
