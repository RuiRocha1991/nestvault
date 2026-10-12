export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';
export const THEME_COOKIE = 'nv-theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The cookie is user-controlled: anything that is not a known theme falls back to the default. */
export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? DEFAULT_THEME;
}
