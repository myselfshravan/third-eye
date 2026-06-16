/**
 * Domain fragments for ad/tracker/analytics networks. Blocking these makes
 * captures faster (fewer requests to wait on) and cleaner (no overlays), and
 * cuts cost. Matched as substrings against the request URL host.
 *
 * Intentionally conservative — we block well-known ad/analytics infra, not
 * arbitrary third parties, to avoid breaking page layout.
 */
export const AD_TRACKER_HOSTS: readonly string[] = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.',
  'facebook.net',
  'connect.facebook.net',
  'ads-twitter.com',
  'analytics.twitter.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'segment.io',
  'fullstory.com',
  'mouseflow.com',
  'clarity.ms',
  'newrelic.com',
  'nr-data.net',
  'sentry.io',
  'bugsnag.com',
  'intercom.io',
  'doubleverify.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'moatads.com',
  'adsrvr.org',
];

/**
 * Common cookie/consent/GDPR banner containers. We hide (not remove) these so
 * layout reflow is minimal. Covers the major CMPs (OneTrust, Cookiebot,
 * Quantcast, Osano, TrustArc, Usercentrics, Didomi, CookieYes, etc.).
 */
export const COOKIE_BANNER_SELECTORS: readonly string[] = [
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#cookiebot',
  '.qc-cmp2-container',
  '.qc-cmp-ui-container',
  '#osano-cm-window',
  '.osano-cm-window',
  '#truste-consent-track',
  '.truste_box_overlay',
  '#usercentrics-root',
  '#didomi-host',
  '.didomi-popup-container',
  '.cky-consent-container',
  '#cookie-consent',
  '#cookie-banner',
  '#cookie-notice',
  '.cookie-banner',
  '.cookie-consent',
  '.cookie-notice',
  '[aria-label="cookieconsent"]',
  '[class*="CookieConsent"]',
  '#gdpr-consent-tool-wrapper',
  '.fc-consent-root',
];
