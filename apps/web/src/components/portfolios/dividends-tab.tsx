'use client';

import {
  BarChart,
  Button,
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  formatMoney,
  formatPct,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { NativeMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import type { OpView } from '@webapp/lib/portfolios-types';
import {
  chipMoney,
  fractionPct,
  monthLabel,
  monthName,
  sumMoney,
  withPlus,
} from '@webapp/lib/portfolios-view';

/** Mockup 05: forecast and received dividends, the calendar, who pays, and the received list. */
export function DividendsTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.dividends');
  const { summary, data } = ctx;
  const cur = data.display.currency;
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
  // Gross, tax withheld and net received, each summed per currency (`1,00 € · 2,00 US$`).
  const perCurrency = (pick: (op: (typeof received)[number]) => string | null) => {
    const groups = new Map<string, string[]>();
    for (const op of received) {
      const currency = ctx.assetsById.get(op.assetId)?.currency ?? 'EUR';
      groups.set(currency, [...(groups.get(currency) ?? []), pick(op) ?? '0']);
    }
    if (groups.size === 0) return formatMoney('0', 'EUR');
    return [...groups.entries()]
      .map(([currency, amounts]) => formatMoney(sumMoney(amounts), currency))
      .join(' · ');
  };
  const monthlyGross = (Number(summary.income) / 12).toFixed(2);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4 kpi2:grid-cols-2 one:grid-cols-1">
        <Stat
          title={t('annualForecast')}
          value={formatMoney(summary.income, cur)}
          hint={t('perMonthGross', { value: formatMoney(monthlyGross, cur) })}
        />
        <Stat
          title={t('estimatedNet')}
          value={formatMoney(data.incomeNet, cur)}
          hint={
            Number(summary.income) > 0
              ? t('afterTaxAverage', {
                  pct: formatPct((1 - Number(data.incomeNet) / Number(summary.income)) * 100, {
                    digits: 1,
                  }),
                })
              : t('afterTax')
          }
        />
        <Stat
          title={t('portfolioYield')}
          value={fractionPct(summary.yld)}
          hint={t('yieldOnCost', { value: fractionPct(summary.yoc) })}
        />
        <Stat
          title={t('received12')}
          value={formatMoney(summary.divs12, cur)}
          hint={t('sinceStart', { value: formatMoney(summary.divs, cur) })}
        />
      </div>

      <Card>
        <CardHeader
          title={t('perMonth')}
          actions={
            <ul className="m-0 flex list-none gap-4 p-0 text-sm text-fg-2">
              <li className="inline-flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-[9px] rounded-full"
                  style={{ background: '#9D6BFF' }}
                />
                {t('legendReceived')}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-[9px] rounded-full"
                  style={{ background: '#F2913D' }}
                />
                {t('legendForecast')}
              </li>
            </ul>
          }
        />
        <BarChart
          labels={labels.map(monthLabel)}
          values={values}
          forecast={forecast}
          highlight={data.received.length - 1}
          label={t('perMonth')}
          forecastNote={t('forecastNote')}
          periodHeader={t('month')}
          empty={t('chartEmpty')}
          height={240}
          width={1000}
          currency={cur}
        />
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 kpi2:col-span-12">
          <CardHeader title={t('calendar')} subtitle={t('calendarHint')} />
          <div className="grid grid-cols-4 gap-2 kpi2:grid-cols-2 one:grid-cols-1">
            {data.forecast.map((month, index) => (
              <div
                key={month.month}
                className={`flex min-h-[96px] flex-col gap-1 rounded-md bg-inset p-3 ${
                  index === 0 ? 'ring-1 ring-accent' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-sm">{monthName(month.month)}</b>
                  <b className="text-sm">
                    {Number(month.value) > 0 ? chipMoney(month.value, cur) : '—'}
                  </b>
                </div>
                {[...month.items]
                  .sort((a, b) => Number(b.value) - Number(a.value))
                  .slice(0, 5)
                  .map((item) => (
                    <div
                      key={item.assetId}
                      className="flex justify-between gap-2 text-xs text-fg-2"
                    >
                      <span className="rounded-sm bg-panel-2 px-1.5">{ticker(item.assetId)}</span>
                      <span>{formatMoney(item.value, cur)}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Card>
        <Card className="col-span-4 kpi2:col-span-12">
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
                      <b>{formatMoney(h.income, cur)}</b>
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
          subtitle={t('receivedTotals', {
            gross: perCurrency((op) => op.gross ?? op.amount),
            tax: perCurrency((op) => op.tax),
            net: perCurrency((op) => op.amount),
          })}
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
                      <AssetCell ticker={asset?.ticker ?? ''} type={asset?.type} compact />
                    </Td>
                    <Td className="text-fg-2">
                      {ctx.portfolios.find((p) => p.id === op.portfolioId)?.name ?? ''}
                    </Td>
                    <Td numeric>{formatMoney(op.gross ?? op.amount ?? '0', currency)}</Td>
                    <TaxCell op={op} currency={currency} />
                    <Td numeric>
                      <NativeMoney
                        native={op.native}
                        converted={op.converted}
                        displayCurrency={cur}
                        currency={currency}
                        signed
                      />
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
      <h3 className="text-base font-semibold">{title}</h3>
      <b className="text-xl font-bold">{value}</b>
      <p className="text-sm text-fg-3">{hint}</p>
    </Card>
  );
}

/** The withholding of a dividend: negative in red with its share of the gross; a refund in green. */
function TaxCell({ op, currency }: { op: OpView; currency: string }) {
  const t = useTranslations('portfolios.dividends');
  const tax = Number(op.tax ?? 0);
  if (op.tax === null || tax === 0)
    return (
      <Td numeric className="text-fg-3">
        {t('none')}
      </Td>
    );
  const gross = Number(op.gross ?? op.amount ?? 0);
  const shown = op.tax.startsWith('-') ? op.tax.slice(1) : `-${op.tax}`;
  return (
    <Td numeric className={tax > 0 ? 'text-neg' : 'text-pos'}>
      {withPlus(formatMoney(shown, currency), shown)}
      <small className="block text-xs text-fg-3">
        {tax < 0 ? t('refund') : gross > 0 ? formatPct((tax / gross) * 100, { digits: 0 }) : ''}
      </small>
    </Td>
  );
}
