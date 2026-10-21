'use client';

import {
  Button,
  Card,
  Chip,
  EmptyState,
  formatDate,
  formatMoney,
  Input,
  Segmented,
  Select,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { NoteIndicator } from '@webapp/components/notes/note-indicator';
import { NoteSheet } from '@webapp/components/notes/note-sheet';
import { useNoteRow } from '@webapp/components/notes/use-note-row';
import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { NativeMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import type { NoteState } from '@webapp/lib/note-view';
import type { OpView } from '@webapp/lib/portfolios-types';
import {
  EMPTY_OP_FILTERS,
  filterOps,
  type OpFilters,
  type OpTypeFilter,
} from '@webapp/lib/portfolios-view';

const PAGE = 100;
const TYPES: readonly OpTypeFilter[] = ['all', 'buy', 'sell', 'dividend'];

/** Mockup 06: the operations of the scope with filters, plan chip, note indicator and actions. */
export function TransactionsTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.transactions');
  const [filters, setFilters] = useState<OpFilters>(EMPTY_OP_FILTERS);
  const [shown, setShown] = useState(PAGE);
  // Notes saved from the side panel, so the indicator changes before the page data is refreshed.
  const [notes, setNotes] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [noteOpen, setNoteOpen] = useState<OpView | null>(null);

  const lookup = useMemo(() => ctx.assetsById, [ctx.assetsById]);
  const noteOf = (op: OpView) => (notes.has(op.id) ? (notes.get(op.id) ?? null) : op.note);
  const ops = filterOps(ctx.data.ops, filters, lookup);
  const visible = ops.slice(0, shown);
  const accountName = (id: string | null) =>
    id === null ? '' : (ctx.accounts.find((a) => a.id === id)?.name ?? '');
  const portfolioName = (id: string) => ctx.portfolios.find((p) => p.id === id)?.name ?? '';
  const brokerageAccounts = ctx.accounts.filter((a) => a.type === 'brokerage' || a.trackCash);

  const set = (patch: Partial<OpFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setShown(PAGE);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={t('type')}
          value={filters.type}
          onChange={(type) => {
            set({ type });
          }}
          options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
        />
        <Select
          aria-label={t('asset')}
          className="w-auto max-w-[180px]"
          value={filters.assetId}
          onChange={(event) => {
            set({ assetId: event.target.value });
          }}
        >
          <option value="">{t('allAssets')}</option>
          {ctx.assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.ticker}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('account')}
          className="w-auto max-w-[200px]"
          value={filters.accountId}
          onChange={(event) => {
            set({ accountId: event.target.value });
          }}
        >
          <option value="">{t('allAccounts')}</option>
          {brokerageAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label={t('from')}
          className="w-auto"
          value={filters.from}
          onChange={(event) => {
            set({ from: event.target.value });
          }}
        />
        <Input
          type="date"
          aria-label={t('to')}
          className="w-auto"
          value={filters.to}
          onChange={(event) => {
            set({ to: event.target.value });
          }}
        />
        <Input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          className="w-[180px]"
          value={filters.text}
          onChange={(event) => {
            set({ text: event.target.value });
          }}
        />
        <span className="ml-auto text-sm text-fg-3">{t('count', { count: ops.length })}</span>
        {ctx.permissions.ops && (
          <Button
            variant="primary"
            onClick={() => {
              open({ kind: 'op' });
            }}
          >
            <Plus aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>

      {ops.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('date')}</Th>
              <Th>{t('asset')}</Th>
              <Th>{t('kind')}</Th>
              <Th>{t('portfolio')}</Th>
              <Th>{t('account')}</Th>
              <Th numeric>{t('qty')}</Th>
              <Th numeric>{t('price')}</Th>
              <Th numeric>{t('amount')}</Th>
              <Th>
                <span className="sr-only">{t('note')}</span>
              </Th>
              <Th>
                <span className="sr-only">{t('actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((op) => (
              <OpRow
                key={op.id}
                op={op}
                note={noteOf(op)}
                ctx={ctx}
                accountName={accountName(op.accountId)}
                portfolioName={portfolioName(op.portfolioId)}
                open={open}
                onNote={() => {
                  setNoteOpen(op);
                }}
              />
            ))}
          </tbody>
        </Table>
      )}
      {ops.length > shown && (
        <Button
          className="self-center"
          onClick={() => {
            setShown((n) => n + PAGE);
          }}
        >
          {t('showMore', { count: ops.length - shown })}
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-sm text-fg-2">
          {t('cash')} <b className="text-fg">{formatMoney(ctx.summary.cash)}</b>
        </span>
        {!!ctx.portfolioId && ctx.permissions.ops && (
          <Button
            size="sm"
            onClick={() => {
              open({ kind: 'moveCash' });
            }}
          >
            {t('moveCash')}
          </Button>
        )}
      </div>

      {!!noteOpen && (
        <NoteSheet
          poolId={ctx.poolId}
          kind="operation"
          id={noteOpen.id}
          note={{ note: noteOf(noteOpen), noteUpdatedBy: null, noteUpdatedAt: null }}
          editorName={null}
          canWrite={ctx.permissions.notes}
          details={
            <p className="text-sm text-fg-2">
              {`${formatDate(noteOpen.date)} · ${lookup.get(noteOpen.assetId)?.ticker ?? ''}`}
            </p>
          }
          onClose={() => {
            setNoteOpen(null);
          }}
          onSaved={(next: NoteState) => {
            setNotes((current) => new Map(current).set(noteOpen.id, next.note));
          }}
        />
      )}
    </Card>
  );
}

function OpRow({
  op,
  note,
  ctx,
  accountName,
  portfolioName,
  open,
  onNote,
}: {
  op: OpView;
  note: string | null;
  ctx: TabContext;
  accountName: string;
  portfolioName: string;
  open: OpenDialog;
  onNote: () => void;
}) {
  const t = useTranslations('portfolios.transactions');
  const tn = useTranslations('notes');
  const rowProps = useNoteRow(onNote);
  const asset = ctx.assetsById.get(op.assetId);
  const currency = asset?.currency ?? 'EUR';
  const tone = op.type === 'buy' ? 'accent' : op.type === 'sell' ? 'warn' : 'pos';

  return (
    <tr {...rowProps} className="hover:bg-panel-2 focus-visible:outline focus-visible:outline-2">
      <Td className="whitespace-nowrap">{formatDate(op.date)}</Td>
      <Td>
        <AssetCell ticker={asset?.ticker ?? ''} compact />
      </Td>
      <Td>
        <Chip tone={tone}>{t(`kinds.${op.type}`)}</Chip>
        {!!op.planId && (
          <Chip className="ml-1" tone="default">
            {t('plan')}
          </Chip>
        )}
      </Td>
      <Td className="text-fg-2">{portfolioName}</Td>
      <Td className="text-fg-2">{accountName}</Td>
      <Td numeric>
        {op.qty === null
          ? ''
          : Number(op.qty).toLocaleString('pt-PT', { maximumFractionDigits: 4 })}
      </Td>
      <Td numeric>{op.price === null ? '' : formatMoney(op.price, currency)}</Td>
      <Td numeric>
        <NativeMoney native={op.native} eur={op.eur} currency={currency} signed />
      </Td>
      <Td>
        <NoteIndicator note={note} label={tn('view')} onOpen={onNote} />
      </Td>
      <Td className="whitespace-nowrap text-right">
        {ctx.permissions.ops && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label={t('edit')}
              onClick={() => {
                open({ kind: 'op', opId: op.id });
              }}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon
              aria-label={t('delete')}
              onClick={() => {
                open({ kind: 'deleteOp', opId: op.id });
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </Td>
    </tr>
  );
}
