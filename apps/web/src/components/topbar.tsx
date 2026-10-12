'use client';

import { Button, Chip, Input } from '@nestvault/ui';
import { Menu, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MENU_BUTTON_ID, SIDEBAR_ID, useShell } from './shell';

/** Page title, search, primary action and holder chips (placeholders until the data exists). */
export function Topbar({ title }: { title: string }) {
  const t = useTranslations('shell');
  const { drawerOpen, openDrawer } = useShell();

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
      <div className="relative min-w-60 drawer:min-w-0 drawer:flex-[1_1_160px]">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3"
        />
        <Input
          type="search"
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          className="h-[38px] rounded-md border-line bg-panel pl-9"
        />
      </div>
      <Button variant="primary" className="h-[38px]">
        <Plus aria-hidden />
        {t('newTransaction')}
      </Button>
      <Chip tone="warm" className="h-[38px] px-4 text-md">
        {t('allHolders')}
      </Chip>
    </header>
  );
}
