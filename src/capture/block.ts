import type { Page } from 'playwright';

/**
 * Best-effort bot-wall / challenge detection. Stealth (Patchright) clears most
 * of these, but when a target still serves an interstitial we want to *report*
 * it honestly rather than silently return a screenshot of "Access Denied".
 */

const BLOCK_STATUSES = new Set([401, 403, 429, 503]);

// Title/body markers used by the major anti-bot vendors.
const CHALLENGE_MARKERS = [
  'just a moment', // Cloudflare
  'attention required', // Cloudflare
  'checking your browser', // Cloudflare (legacy)
  'verify you are human',
  'verifying you are human',
  'access denied', // Akamai
  "you don't have permission to access", // Akamai edgesuite
  'pardon our interruption', // PerimeterX / HUMAN
  'captcha-delivery', // DataDome
  'px-captcha', // PerimeterX
  'cf-chl', // Cloudflare challenge
  'unusual traffic',
];

export async function detectBlock(page: Page, httpStatus: number | null): Promise<boolean> {
  if (httpStatus != null && BLOCK_STATUSES.has(httpStatus)) return true;
  const hit = await page
    .evaluate((markers) => {
      const hay = (
        document.title +
        ' ' +
        (document.body?.innerText ?? '').slice(0, 2000)
      ).toLowerCase();
      return markers.some((m) => hay.includes(m));
    }, CHALLENGE_MARKERS)
    .catch(() => false);
  return hit;
}
