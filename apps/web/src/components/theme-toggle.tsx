'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme } from '../lib/theme';

/** Moon / sun switch. The server renders the saved theme into <html data-theme>, so there is no flash. */
export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const isLight = theme === 'light';

  function toggle() {
    const next: Theme = isLight ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${String(THEME_COOKIE_MAX_AGE)}; SameSite=Lax${secure}`;
  }

  return (
    <div className="flex items-center gap-2 text-fg-3">
      <Moon aria-hidden className="size-4" />
      <button
        type="button"
        role="switch"
        aria-checked={isLight}
        aria-label={t('switchLabel')}
        onClick={toggle}
        className="relative h-5 w-9 rounded-pill border border-line-2 bg-panel-2 p-0"
      >
        <span
          aria-hidden
          className={`absolute left-0.5 top-0.5 size-[14px] rounded-full bg-c-orange transition-transform duration-200 ${isLight ? 'translate-x-4' : ''}`}
        />
      </button>
      <Sun aria-hidden className="size-4" />
    </div>
  );
}
