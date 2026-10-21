'use client';

import { Button, Input, Select } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import type { AccountView, CategoryView } from '@webapp/lib/expenses-types';
import {
  filtersToParams,
  monthLabel,
  MOVEMENT_KINDS,
  NO_FILTERS,
  type MovementFilters,
} from '@webapp/lib/expenses-view';

import { useCategoryLabel } from './use-category-label';

export interface MovementFiltersBarProps {
  poolId: string;
  filters: MovementFilters;
  /** The months the month select offers, oldest first. */
  months: readonly string[];
  accounts: readonly Pick<AccountView, 'id' | 'name'>[];
  categories: readonly CategoryView[];
}

const TEXT_DEBOUNCE_MS = 400;

/** The filters of the Movimentos tab. Every change goes to the URL, so a refresh keeps them. */
export function MovementFiltersBar({
  poolId,
  filters,
  months,
  accounts,
  categories,
}: MovementFiltersBarProps) {
  const t = useTranslations('expenses.movements');
  const tk = useTranslations('expenses.kinds');
  const router = useRouter();
  const label = useCategoryLabel();
  const ids = { month: useId(), account: useId(), category: useId(), kind: useId(), q: useId() };
  const [text, setText] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The filters as the last change left them, even before the URL has caught up: two changes in a
  // row (typing, then ticking a box) must both survive.
  const latest = useRef(filters);
  const typed = useRef(filters.q);

  // A new URL (back button, "clear") replaces what was typed.
  useEffect(() => {
    setText(filters.q);
    typed.current = filters.q;
  }, [filters.q]);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function go(next: MovementFilters) {
    const params = filtersToParams(next);
    router.replace(
      `/${poolId}/despesas?tab=movimentos${params.size ? `&${params.toString()}` : ''}`,
      {
        scroll: false,
      },
    );
  }
  const change = (patch: Partial<MovementFilters>) => {
    if (timer.current) clearTimeout(timer.current);
    // What is typed counts as soon as anything else changes.
    const next = { ...latest.current, q: typed.current, ...patch };
    latest.current = next;
    go(next);
  };

  const dirty = JSON.stringify({ ...filters, showTransfers: true }) !== JSON.stringify(NO_FILTERS);
  const select = (
    id: string,
    text: string,
    children: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <Select
      id={id}
      aria-label={text}
      value={value}
      className="w-auto min-w-[150px] max-w-[260px]"
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {children}
    </Select>
  );

  return (
    <div role="search" aria-label={t('filtersLabel')} className="flex flex-wrap items-center gap-3">
      {select(
        ids.month,
        t('month'),
        <>
          <option value="">{t('allMonths')}</option>
          {[...months].reverse().map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
            </option>
          ))}
        </>,
        filters.month,
        (month) => {
          change({ month });
        },
      )}
      {select(
        ids.account,
        t('account'),
        <>
          <option value="">{t('allAccounts')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </>,
        filters.accountId,
        (accountId) => {
          change({ accountId });
        },
      )}
      {select(
        ids.category,
        t('category'),
        <>
          <option value="">{t('allCategories')}</option>
          <option value="none">{t('noCategory')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {label(category)}
            </option>
          ))}
        </>,
        filters.categoryId,
        (categoryId) => {
          change({ categoryId });
        },
      )}
      {select(
        ids.kind,
        t('kind'),
        <>
          <option value="">{t('allKinds')}</option>
          {MOVEMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {tk(kind)}
            </option>
          ))}
        </>,
        filters.kind,
        (kind) => {
          change({ kind: MOVEMENT_KINDS.find((entry) => entry === kind) ?? '' });
        },
      )}
      <Input
        id={ids.q}
        type="search"
        aria-label={t('search')}
        placeholder={t('searchPlaceholder')}
        maxLength={100}
        value={text}
        className="w-auto min-w-[180px] max-w-[260px]"
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          typed.current = value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            change({ q: value });
          }, TEXT_DEBOUNCE_MS);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          if (timer.current) clearTimeout(timer.current);
          change({ q: text });
        }}
      />
      <label className="inline-flex items-center gap-2 text-md text-fg-2">
        <input
          type="checkbox"
          checked={filters.withNotes}
          className="size-4 accent-[var(--accent)]"
          onChange={(event) => {
            change({ withNotes: event.target.checked });
          }}
        />
        {t('withNotes')}
      </label>
      <label className="inline-flex items-center gap-2 text-md text-fg-2">
        <input
          type="checkbox"
          checked={filters.showTransfers}
          className="size-4 accent-[var(--accent)]"
          onChange={(event) => {
            change({ showTransfers: event.target.checked });
          }}
        />
        {t('showTransfers')}
      </label>
      {dirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            go({ ...NO_FILTERS, showTransfers: filters.showTransfers });
          }}
        >
          {t('clear')}
        </Button>
      )}
    </div>
  );
}
