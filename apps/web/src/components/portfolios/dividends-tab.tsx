'use client';

import {
  BarChart,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Eyebrow,
  formatDate,
  formatMoney,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { NativeMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import { fractionPct, monthLabel, monthName, sumMoney } from '@webapp/lib/portfolios-view';

/** Mockup 05: forecast and received dividends, the calendar, who pays, and the received list. */
export function DividendsTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.dividends');
  const { summary, data } = ctx;
  const ticker = (assetId: string) => ctx.assetsById.get(assetId)?.ticker ?? '';

  // 12 months received (the last one is the current month) and the 11 months that follow.
  const future = data.forecast.slice(1);
  const labels = [...data.received.map((m) => m.month), ...future.map((m) => m.month)];
  const values = [...data.received.map((m) => Number(m.value)), ...future.map(() => 0)];
  const forecast = [...data.received.map(() => 0), ...future.map((m) => Number(m.value))];

  const payers = data.holdings
    .filter((h) => h.isOpen && Number(h.income) > 0)
    .sort((a, b) => Number(b.income) - Number(a.income));
  const biggest = Number(payers[0]?.income ?? 0);

  const received = data.ops.filter((op) => op.type === 'dividend');
  const receivedNet = sumMoney(received.map((op) => op.eur));
  const monthlyGross = (Number(summary.income) / 12).toFixed(2);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
        <Stat
          title={t('annualForecast')}
          value={formatMoney(summary.income)}
          hint={t('perMonthGross', { value: formatMoney(monthlyGross) })}
        />
        <Stat title={t('estimatedNet')} value={formatMoney(data.incomeNet)} hint={t('afterTax')} />
        <Stat
          title={t('portfolioYield')}
          value={fractionPct(summary.yld)}
          hint={t('yieldOnCost', { value: fractionPct(summary.yoc) })}
        />
        <Stat
          title={t('received12')}
          value={formatMoney(summary.divs12)}
          hint={t('sinceStart', { value: formatMoney(summary.divs) })}
        />
      </div>

      <Card>
        <CardHeader title={t('perMonth')} />
        <BarChart
          labels={labels.map(monthLabel)}
          values={values}
          forecast={forecast}
          highlight={data.received.length - 1}
          label={t('perMonth')}
          forecastNote={t('forecastNote')}
          periodHeader={t('month')}
          empty={t('chartEmpty')}
          height={260}
        />
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 max-[1100px]:col-span-12">
          <CardHeader title={t('calendar')} subtitle={t('calendarHint')} />
          <div className="grid grid-cols-4 gap-2 max-[900px]:grid-cols-2 max-[500px]:grid-cols-1">
            {data.forecast.map((month, index) => (
              <div
                key={month.month}
                className={`flex min-h-[96px] flex-col gap-1 rounded-md bg-inset p-3 ${
                  index === 0 ? 'ring-1 ring-accent' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-sm">{monthName(month.month)}</b>
                  <b className="text-sm">{formatMoney(month.value)}</b>
                </div>
                {month.items.map((item) => (
                  <div key={item.assetId} className="flex justify-between gap-2 text-xs text-fg-2">
                    <span className="rounded-sm bg-panel-2 px-1.5">{ticker(item.assetId)}</span>
                    <span>{formatMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
        <Card className="col-span-4 max-[1100px]:col-span-12">
          <CardHeader title={t('whoPays')} />
          {payers.length === 0 ? (
            <EmptyState title={t('whoPaysEmpty')} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {payers.map((h) => {
                const asset = ctx.assetsById.get(h.assetId);
                return (
                  <li key={h.key} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span>
                        <b>{asset?.ticker}</b>
                        <span className="text-fg-3">
                          {' · '}
                          {t('perShare', {
                            dps: formatMoney(asset?.dps ?? '0', h.currency),
                            times: asset?.divMonths.length ?? 0,
                          })}
                        </span>
                      </span>
                      <b>{formatMoney(h.income)}</b>
                    </div>
                    <div className="h-1 overflow-hidden rounded-pill bg-inset">
                      <div
                        className="h-full rounded-pill bg-grad-warm"
                        style={{ width: `${Math.max(2, (Number(h.income) / biggest) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t('receivedTitle')}
          subtitle={t('receivedTotals', { net: formatMoney(receivedNet), count: received.length })}
          actions={
            ctx.permissions.ops && (
              <Button
                size="sm"
                onClick={() => {
                  open({ kind: 'op', type: 'dividend' });
                }}
              >
                <Plus aria-hidden />
                {t('register')}
              </Button>
            )
          }
        />
        {received.length === 0 ? (
          <EmptyState title={t('receivedEmpty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('date')}</Th>
                <Th>{t('asset')}</Th>
                <Th>{t('portfolio')}</Th>
                <Th numeric>{t('gross')}</Th>
                <Th numeric>{t('tax')}</Th>
                <Th numeric>{t('net')}</Th>
                <Th>
                  <span className="sr-only">{t('actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {received.map((op) => {
                const asset = ctx.assetsById.get(op.assetId);
                const currency = asset?.currency ?? 'EUR';
                return (
                  <tr key={op.id}>
                    <Td>{formatDate(op.date)}</Td>
                    <Td>
                      <AssetCell ticker={asset?.ticker ?? ''} compact />
                    </Td>
                    <Td className="text-fg-2">
                      {ctx.portfolios.find((p) => p.id === op.portfolioId)?.name ?? ''}
                    </Td>
                    <Td numeric>{formatMoney(op.gross ?? op.amount ?? '0', currency)}</Td>
                    <Td numeric className="text-fg-3">
                      {op.tax === null ? t('none') : formatMoney(op.tax, currency)}
                    </Td>
                    <Td numeric>
                      <NativeMoney native={op.native} eur={op.eur} currency={currency} signed />
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
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <b className="text-2xl">{value}</b>
      <p className="text-sm text-fg-3">{hint}</p>
    </Card>
  );
}
