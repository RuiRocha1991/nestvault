'use client';

import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  formatDate,
  formatMoney,
  Table,
  Th,
  useToast,
} from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NoteSheet } from '@webapp/components/notes/note-sheet';
import type {
  AccountView,
  CategoryView,
  HolderNameView,
  TotalsView,
  TransactionView,
} from '@webapp/lib/expenses-types';
import {
  filtersToApiQuery,
  isShown,
  kindFor,
  moveInTotals,
  type MovementFilters,
} from '@webapp/lib/expenses-view';
import { sendJson } from '@webapp/lib/post-json';

import { ConfirmDeleteDialog } from './confirm-delete-dialog';
import { MovementFiltersBar } from './movement-filters';
import { MovementRow } from './movement-row';
import { RuleDialog } from './rule-dialog';

export interface MovementsTabProps {
  poolId: string;
  filters: MovementFilters;
  /** The months the month filter offers, oldest first. */
  months: readonly string[];
  initial: { transactions: TransactionView[]; nextCursor: string | null };
  initialTotals: TotalsView;
  accounts: readonly AccountView[];
  categories: readonly CategoryView[];
  holders: readonly HolderNameView[];
  /** `transactions.write`. */
  canWrite: boolean;
  /** `notes.write`; without it the note opens read-only. */
  canNotes: boolean;
  /** `categories.write`. */
  canRules: boolean;
}

const PAGE = 50;

type Dialog =
  { kind: 'note'; id: string } | { kind: 'delete'; id: string } | { kind: 'rule'; id: string };

const apiBase = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}`;

/**
 * The Movimentos tab (mockup 11): filters, totals of what the filters select, and the table with
 * inline category, transfer toggle, notes and infinite scroll. A change shows at once and is
 * confirmed by the server; if the server refuses, the row goes back to what it was.
 */
export function MovementsTab({
  poolId,
  filters,
  months,
  initial,
  initialTotals,
  accounts,
  categories,
  holders,
  canWrite,
  canNotes,
  canRules,
}: MovementsTabProps) {
  const t = useTranslations('expenses.movements');
  const tt = useTranslations('expenses');
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initial.transactions);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [totals, setTotals] = useState(initialTotals);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);
  const totalsSeq = useRef(0);

  // A fresh answer of the server (a new filter, a movement added elsewhere) replaces the local rows.
  useEffect(() => {
    setRows(initial.transactions);
    setCursor(initial.nextCursor);
    setTotals(initialTotals);
    setLoadFailed(false);
  }, [initial, initialTotals]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const holderName = useMemo(() => new Map(holders.map((h) => [h.id, h.name])), [holders]);
  const holderByUser = useMemo(
    () => new Map(holders.flatMap((h) => (h.userId ? [[h.userId, h.name] as const] : []))),
    [holders],
  );
  const query = filtersToApiQuery(filters).toString();

  const accountLabel = (accountId: string) => {
    const account = accountById.get(accountId);
    if (!account) return '';
    const owners = account.holderIds.map((id) => holderName.get(id)).filter(Boolean);
    return owners.length > 0 ? `${account.name} · ${owners.join(', ')}` : account.name;
  };
  const currencyOf = (accountId: string) => accountById.get(accountId)?.currency ?? 'EUR';

  const refreshTotals = useCallback(async () => {
    const seq = ++totalsSeq.current;
    try {
      const response = await fetch(`${apiBase(poolId)}/expenses/totals?${query}`, {
        credentials: 'same-origin',
      });
      if (!response.ok || seq !== totalsSeq.current) return;
      setTotals((await response.json()) as TotalsView);
    } catch {
      // The guess shown stays until the next change.
    }
  }, [poolId, query]);

  const loadMore = useCallback(async () => {
    if (busy.current || cursor === null) return;
    busy.current = true;
    setLoading(true);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams(query);
      params.set('cursor', cursor);
      params.set('limit', String(PAGE));
      const response = await fetch(`${apiBase(poolId)}/transactions?${params.toString()}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('page');
      const page = (await response.json()) as {
        transactions: TransactionView[];
        nextCursor: string | null;
      };
      setRows((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.transactions.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setLoadFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, poolId, query]);

  // Infinite scroll: the sentinel under the table asks for the next page when it comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || cursor === null || loadFailed || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [cursor, loadFailed, loadMore]);

  /** Shows `next` for the row at once; the request confirms it or puts `previous` back. */
  async function change(
    previous: TransactionView,
    next: TransactionView,
    request: () => Promise<Response>,
  ) {
    const guess = moveInTotals(
      totals,
      {
        amount: previous.amount,
        currency: currencyOf(previous.accountId),
        kind: previous.kind,
        uncategorized: previous.categoryId === null,
      },
      { kind: next.kind, uncategorized: next.categoryId === null },
    );
    setRows((current) => current.map((row) => (row.id === previous.id ? next : row)));
    setTotals(guess);
    try {
      const response = await request();
      if (!response.ok) throw new Error('refused');
      const confirmed = (await response.json()) as TransactionView;
      setRows((current) => current.map((row) => (row.id === confirmed.id ? confirmed : row)));
      void refreshTotals();
    } catch {
      setRows((current) => current.map((row) => (row.id === previous.id ? previous : row)));
      void refreshTotals();
      toast.show(t('optimisticError'));
    }
  }

  const path = (id: string) => `${apiBase(poolId)}/transactions/${encodeURIComponent(id)}`;

  function changeCategory(row: TransactionView, categoryId: string) {
    const category = categoryById.get(categoryId);
    // Choosing the transfer category by hand makes it a transfer (unless the flag is locked).
    const transfer = row.transfer || (category?.kind === 'transfer' && !row.transferLocked);
    void change(
      row,
      {
        ...row,
        categoryId,
        manualCategory: true,
        transfer,
        kind: kindFor(category, row.amount, transfer),
      },
      () => sendJson('PATCH', path(row.id), { categoryId }),
    );
  }

  function toggleTransfer(row: TransactionView) {
    const transfer = !row.transfer;
    void change(
      row,
      {
        ...row,
        transfer,
        transferLocked: true,
        kind: kindFor(
          row.categoryId ? categoryById.get(row.categoryId) : undefined,
          row.amount,
          transfer,
        ),
      },
      () => sendJson('PATCH', path(row.id), { transfer }),
    );
  }

  const shown = rows.filter((row) => isShown(row.kind, filters.showTransfers));
  const target = dialog ? rows.find((row) => row.id === dialog.id) : undefined;
  const targetAccount = target ? accountById.get(target.accountId) : undefined;

  const kpi = (title: string, value: string, extra?: { hint?: string; tone?: string }) => (
    <div className="flex flex-col gap-1">
      <dt>
        <Eyebrow>{title}</Eyebrow>
      </dt>
      <dd className={`m-0 text-xl font-bold tabular-nums ${extra?.tone ?? ''}`}>{value}</dd>
      {!!extra?.hint && <span className="text-sm text-fg-3">{extra.hint}</span>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4">
        <MovementFiltersBar
          poolId={poolId}
          filters={filters}
          months={months}
          accounts={accounts}
          categories={categories}
        />
        <dl className="m-0 grid grid-cols-5 gap-4 kpi2:grid-cols-3 one:grid-cols-2">
          {kpi(t('income'), formatMoney(totals.income), { tone: 'text-pos' })}
          {kpi(t('expenses'), formatMoney(totals.expenses))}
          {kpi(t('invested'), formatMoney(totals.invested))}
          {kpi(t('transfers'), formatMoney(totals.transfers), {
            hint: t('transfersHint'),
            tone: 'text-fg-3',
          })}
          {kpi(t('uncategorized'), String(totals.uncategorized))}
        </dl>
      </Card>

      <Card className="gap-3">
        {shown.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} />
        ) : (
          <Table aria-label={t('tableLabel')}>
            <thead>
              <tr>
                <Th>{t('date')}</Th>
                <Th>{t('description')}</Th>
                <Th className="one:hidden">{t('accountColumn')}</Th>
                <Th>{t('categoryColumn')}</Th>
                <Th numeric>{t('amount')}</Th>
                <Th className="text-right">
                  <span className="sr-only">{t('actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <MovementRow
                  key={row.id}
                  row={row}
                  accountLabel={accountLabel(row.accountId)}
                  currency={currencyOf(row.accountId)}
                  categories={categories}
                  canWrite={canWrite}
                  canRules={canRules}
                  onCategory={(categoryId) => {
                    changeCategory(row, categoryId);
                  }}
                  onToggleTransfer={() => {
                    toggleTransfer(row);
                  }}
                  onNote={() => {
                    setDialog({ kind: 'note', id: row.id });
                  }}
                  onRule={() => {
                    setDialog({ kind: 'rule', id: row.id });
                  }}
                  onDelete={() => {
                    setDialog({ kind: 'delete', id: row.id });
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
        <div ref={sentinel} className="flex flex-col items-center gap-2 py-2 text-sm text-fg-3">
          {cursor !== null && (
            <Button
              size="sm"
              disabled={loading}
              onClick={() => {
                void loadMore();
              }}
            >
              {loading ? t('loading') : t('loadMore')}
            </Button>
          )}
          {loadFailed && (
            <p role="alert" className="m-0 text-neg">
              {t('loadError')}
            </p>
          )}
          {cursor === null && shown.length > 0 && (
            <span>{t('shown', { count: shown.length })}</span>
          )}
        </div>
      </Card>

      {dialog?.kind === 'note' && target && (
        <NoteSheet
          poolId={poolId}
          kind="transaction"
          id={target.id}
          note={{
            note: target.note,
            noteUpdatedBy: target.noteUpdatedBy,
            noteUpdatedAt: target.noteUpdatedAt,
          }}
          editorName={holderByUser.get(target.noteUpdatedBy ?? '') ?? null}
          canWrite={canNotes}
          details={
            <>
              <p className="m-0 font-semibold">{target.description}</p>
              <p className="m-0 text-fg-3">
                {t('detailsDate', {
                  date: formatDate(target.date),
                  amount: formatMoney(target.amount, targetAccount?.currency ?? 'EUR'),
                })}
              </p>
            </>
          }
          onClose={() => {
            setDialog(null);
          }}
          onSaved={(saved) => {
            setRows((current) =>
              current.map((row) => (row.id === target.id ? { ...row, ...saved } : row)),
            );
          }}
        />
      )}
      {dialog?.kind === 'delete' && target && (
        <ConfirmDeleteDialog
          title={t('deleteTitle')}
          text={t('deleteText', { description: target.description })}
          confirmLabel={t('deleteConfirm')}
          path={path(target.id)}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setRows((current) => current.filter((row) => row.id !== target.id));
            setDialog(null);
            toast.show(tt('toasts.movementDeleted'));
            void refreshTotals();
            router.refresh();
          }}
        />
      )}
      {dialog?.kind === 'rule' && target && (
        <RuleDialog
          poolId={poolId}
          initial={{ keyword: target.suggestedKeyword, categoryId: target.categoryId }}
          suggested
          categories={categories}
          accounts={accounts}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setDialog(null);
            toast.show(tt('rules.savedToast'));
          }}
        />
      )}
    </div>
  );
}
