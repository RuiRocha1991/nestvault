export interface DeviceInfo {
  /** `null` when the user agent says nothing recognisable. */
  browser: string | null;
  /** Operating system or device: macOS, Windows, Linux, Android, iPhone, iPad. */
  os: string | null;
  kind: 'desktop' | 'mobile';
}

// Order matters: Edge, Opera and Chrome on iOS also say "Chrome" or "Safari".
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

const MOBILE = new Set(['iPhone', 'iPad', 'Android']);

/** Reads the browser and the system from a user agent. Display only: it is client-supplied. */
export function parseUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const text = (userAgent ?? '').slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  return { browser, os, kind: os && MOBILE.has(os) ? 'mobile' : 'desktop' };
}
