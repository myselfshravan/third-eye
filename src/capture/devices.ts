import type { DeviceName } from '../core/schema.js';

export interface DeviceProfile {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
}

const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/**
 * Faithful device emulation needs four things together: CSS viewport,
 * devicePixelRatio, the mobile layout flag, and a matching UA. Getting DPR
 * wrong is the #1 cause of "blurry"/"wrong size" screenshots.
 */
export const DEVICES: Record<DeviceName, DeviceProfile> = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: CHROME_DESKTOP_UA },
  'desktop-hd': { width: 1920, height: 1080, deviceScaleFactor: 2, isMobile: false, hasTouch: false, userAgent: CHROME_DESKTOP_UA },
  'iphone-15': { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  'iphone-15-pro-max': { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  'iphone-se': { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  'pixel-7': { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  'galaxy-s23': { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  'ipad-pro-11': { width: 834, height: 1194, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  'ipad-mini': { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
};

export const DEFAULT_DEVICE: DeviceName = 'desktop';
