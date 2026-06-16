import { chromium as playwrightChromium } from 'playwright';
import { chromium as patchrightChromium } from 'patchright';
import { config } from '../core/config.js';

/**
 * The Chromium engine the pool launches.
 *
 * Patchright is a drop-in, API-compatible fork of Playwright that ships a
 * Chromium patched at the binary level to remove headless/automation tells
 * (the `navigator.webdriver` flag, the `Runtime.enable` CDP leak Cloudflare
 * watches, headless UA tokens, …). When `STEALTH=true` we launch through it;
 * otherwise we use stock Playwright. Both expose the same API, so the rest of
 * the codebase is unchanged — we just cast to Playwright's type.
 */
export const browserEngine: typeof playwrightChromium = config.browser.stealth
  ? (patchrightChromium as unknown as typeof playwrightChromium)
  : playwrightChromium;

export const engineName = config.browser.stealth ? 'patchright' : 'playwright';
