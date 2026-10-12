'use client';

import { cn } from '@nestvault/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { Theme } from '@webapp/lib/theme';

import { NAV_GROUPS } from './nav';
import { SIDEBAR_ID, useShell } from './shell';
import { ThemeToggle } from './theme-toggle';

export interface SidebarPortfolio {
  id: string;
  name: string;
  /** Series colour (CSS colour). */
  color: string;
}

export interface SidebarProps {
  poolId: string;
  portfolios: readonly SidebarPortfolio[];
  theme: Theme;
}

const linkStyles =
  'flex items-center gap-3 rounded-md px-3 py-[9px] text-md font-medium text-fg-2 ' +
  'hover:bg-panel-2 hover:text-fg aria-[current=page]:bg-accent aria-[current=page]:text-on-accent ' +
  'aria-[current=page]:shadow-[0_6px_18px_-6px_var(--accent)]';

export function Sidebar({ poolId, portfolios, theme }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { drawerOpen } = useShell();
  const base = `/${poolId}`;

  const isActive = (path: string) => {
    const href = `${base}${path}`;
    return path === '' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside
      id={SIDEBAR_ID}
      className={cn(
        'sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto border-r border-line bg-sidebar px-3 py-6',
        // Drawer (≤ 860 px): off-canvas and removed from the tab order while closed.
        'drawer:fixed drawer:inset-y-0 drawer:left-0 drawer:z-40 drawer:h-full drawer:w-[min(280px,86vw)]',
        // Visibility flips at once when opening (so focus can enter) and after the slide when closing.
        drawerOpen
          ? 'drawer:visible drawer:translate-x-0 drawer:[transition:transform_0.2s,visibility_0s]'
          : 'drawer:invisible drawer:-translate-x-[102%] drawer:[transition:transform_0.2s,visibility_0s_0.2s]',
      )}
    >
      <div className="flex flex-col px-3 leading-none">
        <b className="bg-grad-warm bg-clip-text text-[26px] font-extrabold tracking-[0.02em] text-transparent">
          {t('brand.name')}
        </b>
        <span className="mt-[5px] text-[9.5px] font-semibold tracking-[0.32em] text-fg-2">
          {t('brand.tagline')}
        </span>
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-col gap-0.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">
              {t(`nav.groups.${group.key}`)}
            </span>
            {group.items.map((item) => (
              <div key={item.key} className="flex flex-col gap-0.5">
                <Link
                  href={`${base}${item.path}`}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  className={linkStyles}
                >
                  <item.icon aria-hidden className="size-[18px] shrink-0" />
                  {t(`nav.items.${item.key}`)}
                </Link>
                {item.key === 'portfolios'
                  ? portfolios.map((portfolio) => {
                      const href = `${base}/portfolios/${portfolio.id}`;
                      return (
                        <Link
                          key={portfolio.id}
                          href={href}
                          aria-current={pathname === href ? 'page' : undefined}
                          className={cn(linkStyles, 'py-1.5 pl-[42px] text-sm')}
                        >
                          <i
                            aria-hidden
                            className="-ml-5 size-2 shrink-0 rounded-full"
                            style={{ background: portfolio.color }}
                          />
                          {portfolio.name}
                        </Link>
                      );
                    })
                  : null}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3 px-3">
        <p className="flex items-start gap-1.5 text-xs text-fg-3">
          <i aria-hidden className="mt-1 size-[7px] shrink-0 rounded-full bg-pos" />
          {t('shell.saveStatus')}
        </p>
        <ThemeToggle initialTheme={theme} />
      </div>
    </aside>
  );
}
