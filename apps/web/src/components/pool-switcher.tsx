'use client';

import { cn } from '@nestvault/ui';
import { Check, ChevronDown, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { PoolSummary } from '@webapp/lib/pool';

const tile = 'grid size-7 shrink-0 place-items-center rounded-sm bg-panel-2 text-accent-2';
const itemStyles =
  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-md font-medium text-fg-2 no-underline hover:bg-panel-2 hover:text-fg';

/**
 * The pool at the top of the sidebar (mockup 70). Always renders a dropdown: with one pool it shows
 * only "Criar agregado" and "Todos os agregados"; with several it also lists the pools above those
 * two links. Plain links keep the URL as the source of truth and work without scripts.
 */
export function PoolSwitcher({
  pool,
  pools,
}: {
  pool: PoolSummary;
  pools: readonly PoolSummary[];
}) {
  const t = useTranslations('pools');
  const header = (
    <>
      <span aria-hidden className={tile}>
        <Users className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <b className="truncate text-md font-semibold text-fg">{pool.name}</b>
        <span className="truncate text-xs text-fg-3">{t(`roles.${pool.role}`)}</span>
      </span>
    </>
  );

  const actions = (
    <div className="mt-1.5 flex flex-col gap-0.5 rounded-md border border-line-2 bg-panel p-1.5 shadow-card">
      {pools.length >= 2 && (
        <>
          <span className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">
            {t('switcher.yours')}
          </span>
          {pools.map((entry) => (
            <Link
              key={entry.id}
              href={`/${entry.id}`}
              aria-current={entry.id === pool.id ? 'page' : undefined}
              className={cn(itemStyles, entry.id === pool.id && 'bg-panel-2 text-fg')}
            >
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <b className="truncate font-semibold">{entry.name}</b>
                <span className="truncate text-xs text-fg-3">{t(`roles.${entry.role}`)}</span>
              </span>
              {entry.id === pool.id && (
                <Check aria-hidden className="size-4 shrink-0 text-accent-2" />
              )}
            </Link>
          ))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      <Link href="/pools/novo" className={itemStyles}>
        <Plus aria-hidden className="size-4 shrink-0" />
        {t('switcher.create')}
      </Link>
      <Link href="/pools?escolher=1" className={itemStyles}>
        <Users aria-hidden className="size-4 shrink-0" />
        {t('switcher.all')}
      </Link>
    </div>
  );

  return (
    <details className="group relative">
      <summary
        aria-label={t('switcher.label')}
        className="flex cursor-pointer list-none items-center gap-2.5 rounded-md border border-line-2 px-2.5 py-2 hover:border-accent-2 [&::-webkit-details-marker]:hidden"
      >
        {header}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3 group-open:rotate-180" />
      </summary>
      {actions}
    </details>
  );
}
