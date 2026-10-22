'use client';

import {
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  formatMoney,
  formatPct,
  Segmented,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';

import type { TabContext } from '@webapp/components/portfolios/types';
import { tileBackground, TYPE_META } from '@webapp/lib/accounts-view';
import type { LinkedAccountRow } from '@webapp/lib/portfolios-types';
import { sumMoney } from '@webapp/lib/portfolios-view';

interface Line {
  key: string;
  /** More than one account behind the line: a group of applications. */
  group: readonly LinkedAccountRow[];
}

/** "Contas neste portfolio": balance, rate and interest of the linked accounts, grouped by name. */
export function LinkedAccountsCard({ ctx }: { ctx: TabContext }) {
  const t = useTranslations('portfolios.summary.accounts');
  const tTypes = useTranslations('accounts.types');
  const cur = ctx.data.display.currency;
  const rows = ctx.linkedAccounts;
  const hasGroups = rows.some((row) => row.groupName !== null);
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const lines: Line[] = [];
  const byName = new Map<string, Line>();
  for (const row of rows) {
    const name = grouped ? row.groupName : null;
    if (name === null) {
      lines.push({ key: row.id, group: [row] });
      continue;
    }
    const found = byName.get(name);
    if (found) {
      (found.group as LinkedAccountRow[]).push(row);
    } else {
      const line = { key: `group:${name}`, group: [row] };
      byName.set(name, line);
      lines.push(line);
    }
  }

  const holderNames = (items: readonly LinkedAccountRow[]) =>
    ctx.holders
      .filter((holder) => items.some((row) => row.holderIds.includes(holder.id)))
      .map((holder) => holder.name)
      .join(' & ');

  /** Own currency first, the display-currency equivalent under it when they differ. */
  const money = (amount: string, row: LinkedAccountRow, inDisplay: string) => (
    <>
      {formatMoney(amount, row.currency)}
      {row.currency !== cur && (
        <small className="block text-xs text-fg-3">{`(${formatMoney(inDisplay, cur)})`}</small>
      )}
    </>
  );

  const tile = (row: LinkedAccountRow) => {
    const meta = TYPE_META[row.type];
    return (
      <span
        aria-hidden
        className="grid size-[30px] shrink-0 place-items-center rounded-md"
        style={{ background: tileBackground(meta.color), color: meta.color }}
      >
        <meta.icon className="size-[18px]" />
      </span>
    );
  };

  const single = (row: LinkedAccountRow, nested = false) => (
    <tr key={row.id}>
      <Td>
        <div className={`flex min-w-0 items-center gap-2.5 ${nested ? 'pl-7' : ''}`}>
          {tile(row)}
          <div className="flex min-w-0 flex-col">
            <b className="font-semibold">{row.name}</b>
            <span className="max-w-[260px] truncate text-sm text-fg-3">
              {[
                row.institution,
                row.since
                  ? t('since', { date: formatDate(row.since) })
                  : tTypes(TYPE_META[row.type].messageKey),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>
      </Td>
      <Td className="text-fg-3">{holderNames([row])}</Td>
      <Td numeric>
        <b>{money(row.balance, row, row.balanceDisplay)}</b>
      </Td>
      <Td numeric>{Number(row.rate) > 0 ? formatPct(row.rate ?? '0', { digits: 2 }) : '—'}</Td>
      <Td numeric className="text-pos">
        {row.interest12 === null || row.interest12Display === null
          ? '—'
          : money(row.interest12, row, row.interest12Display)}
      </Td>
      <Td numeric className="text-pos">
        {money(row.interestTotal, row, row.interestTotalDisplay)}
      </Td>
    </tr>
  );

  const groupLine = (line: Line) => {
    const items = line.group;
    const first = items[0] as LinkedAccountRow;
    const isOpen = open.has(line.key);
    const total = sumMoney(items.map((row) => row.balanceDisplay));
    // The average rate is weighted by each application's balance.
    const weighted = items.reduce(
      (sum, row) => sum + Number(row.rate ?? 0) * Number(row.balanceDisplay),
      0,
    );
    const rate = Number(total) === 0 ? 0 : weighted / Number(total);
    const banks = [...new Set(items.map((row) => row.institution).filter(Boolean))].join(', ');
    return (
      <Fragment key={line.key}>
        <tr
          className="cursor-pointer hover:bg-panel-2"
          aria-expanded={isOpen}
          onClick={() => {
            setOpen((current) => {
              const next = new Set(current);
              if (!next.delete(line.key)) next.add(line.key);
              return next;
            });
          }}
        >
          <Td>
            <div className="flex min-w-0 items-center gap-2.5">
              {tile(first)}
              <div className="flex min-w-0 flex-col">
                <b className="font-semibold">{`${isOpen ? '▾' : '▸'} ${first.groupName ?? ''}`}</b>
                <span className="max-w-[260px] truncate text-sm text-fg-3">
                  {[t('applications', { count: items.length }), banks].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          </Td>
          <Td className="text-fg-3">{holderNames(items)}</Td>
          <Td numeric>
            <b>{formatMoney(total, cur)}</b>
          </Td>
          <Td numeric>
            {rate > 0 ? formatPct(rate, { digits: 2 }) : '—'}
            <small className="block text-xs text-fg-3">{t('average')}</small>
          </Td>
          <Td numeric className="text-pos">
            {formatMoney(sumMoney(items.map((row) => row.interest12Display ?? '0')), cur)}
          </Td>
          <Td numeric className="text-pos">
            {formatMoney(sumMoney(items.map((row) => row.interestTotalDisplay)), cur)}
          </Td>
        </tr>
        {isOpen && items.map((row) => single(row, true))}
      </Fragment>
    );
  };

  return (
    <Card>
      <CardHeader
        title={t('title')}
        actions={
          <>
            {hasGroups && (
              <Segmented
                label={t('view')}
                value={grouped ? 'grouped' : 'all'}
                onChange={(value) => {
                  setGrouped(value === 'grouped');
                }}
                options={[
                  { value: 'grouped', label: t('grouped') },
                  { value: 'all', label: t('all') },
                ]}
              />
            )}
            <Link
              href={`/${encodeURIComponent(ctx.poolId)}/contas`}
              className="inline-flex h-7 items-center rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold no-underline"
            >
              {t('manage')}
            </Link>
          </>
        }
      />
      {lines.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('account')}</Th>
              <Th>{t('holders')}</Th>
              <Th numeric>{t('balance')}</Th>
              <Th numeric>{t('rate')}</Th>
              <Th numeric>{t('interest12')}</Th>
              <Th numeric>{t('interestTotal')}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              line.group.length > 1 ? groupLine(line) : single(line.group[0] as LinkedAccountRow),
            )}
          </tbody>
        </Table>
      )}
      {!hasGroups && lines.length > 0 && <span className="text-sm text-fg-3">{t('tip')}</span>}
    </Card>
  );
}
