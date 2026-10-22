'use client';

import { Button, Input } from '@nestvault/ui';
import { Menu, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { usePageHeader, type PageHeaderData } from './page-header-context';
import { MENU_BUTTON_ID, SIDEBAR_ID, useShell } from './shell';

/** The names of the household's first three people get an avatar each, like the prototype. */
const AVATARS = 3;

/**
 * Page title, search (tickers and movement descriptions, answered by the search page), the primary
 * "+ Transação" action and the household's people (mockup 01-visao-geral). The pool data comes from
 * the app frame; a page may pass its own.
 */
export function Topbar({ title, header }: { title: string; header?: PageHeaderData }) {
  const t = useTranslations('shell');
  const tOverview = useTranslations('overview.header');
  const { drawerOpen, openDrawer } = useShell();
  const fromFrame = usePageHeader();
  const data = header ?? fromFrame;

  return (
    <header className="mb-5 flex flex-wrap items-center gap-3">
      <Button
        id={MENU_BUTTON_ID}
        variant="ghost"
        icon
        aria-label={t('openMenu')}
        aria-controls={SIDEBAR_ID}
        aria-expanded={drawerOpen}
        onClick={openDrawer}
        className="hidden drawer:inline-flex"
      >
        <Menu aria-hidden />
      </Button>
      <h1 className="mr-auto text-2xl font-bold tracking-[-0.01em]">{title}</h1>
      <form
        role="search"
        action={data ? `/${data.poolId}/pesquisa` : undefined}
        method="get"
        className="relative min-w-60 drawer:min-w-0 drawer:flex-[1_1_160px]"
      >
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3"
        />
        <Input
          type="search"
          name="q"
          required
          maxLength={100}
          aria-label={tOverview('searchLabel')}
          placeholder={t('searchPlaceholder')}
          className="h-[38px] rounded-md border-line bg-panel pl-9"
        />
      </form>
      {!!data?.canAddTransaction && (
        <Link
          href={`/${data.poolId}/despesas?nova=1`}
          className="inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-accent bg-accent px-3.5 text-md font-semibold text-on-accent no-underline hover:border-accent-2 hover:bg-accent-2 [&_svg]:size-4"
        >
          <Plus aria-hidden />
          {t('newTransaction')}
        </Link>
      )}
      {!!data && data.holders.length > 0 && (
        <div
          aria-label={tOverview('holders')}
          role="group"
          className="inline-flex h-[38px] items-center gap-2.5 rounded-md border border-line bg-panel pl-1.5 pr-3 text-md font-semibold text-fg"
        >
          <span className="flex">
            {data.holders.slice(0, AVATARS).map((holder) => (
              <span
                key={holder.id}
                aria-hidden
                className="-ml-2 grid size-[26px] place-items-center rounded-full border-2 border-panel text-[11px] font-bold text-white first:ml-0"
                style={{ background: holder.color }}
              >
                {holder.name.trim().charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
          <span className="max-w-[26ch] truncate drawer:hidden">
            {data.holders.map((holder) => holder.name).join(' & ')}
          </span>
        </div>
      )}
    </header>
  );
}
