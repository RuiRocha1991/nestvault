'use client';

import {
  BarChart,
  Card,
  ChartLegend,
  CardHeader,
  Donut,
  EmptyState,
  Eyebrow,
  formatMoney,
  formatNumber,
  formatPct,
  LineChart,
  Segmented,
  Select,
  Table,
  Td,
  Th,
  seriesColor,
} from '@nestvault/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { LinkedAccountsCard } from '@webapp/components/portfolios/linked-accounts-card';
import { NativeMoney, SignedMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import {
  chipMoney,
  daysBetween,
  fractionPct,
  monthLabel,
  negate,
  portfoliosPath,
  performanceWindow,
  STALE_PRICE_DAYS,
  sumMoney,
  toneClass,
  withPlus,
  type PerformanceRange,
} from '@webapp/lib/portfolios-view';

type AllocationKey = 'asset' | 'type' | 'sector' | 'region' | 'currency';
const ALLOCATIONS: readonly AllocationKey[] = ['asset', 'type', 'sector', 'region', 'currency'];
const RANGES: readonly PerformanceRange[] = ['sixMonths', 'oneYear', 'threeYears', 'all'];
const TOP_POSITIONS = 6;
const LEGEND_ROWS = 8;
/** Data colours of the performance chart (design system §3). */
const VALUE_COLOR = '#9D6BFF';
const INVESTED_COLOR = '#AEB0D2';

/** Mockups 02 and mobile-02: the numbers, the performance chart, allocation, accounts and dividends. */
export function SummaryTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.summary');
  const { summary, data, poolId, portfolioId } = ctx;
  const cur = data.display.currency;
  const dividends = data.hasDividends;
  const [range, setRange] = useState<PerformanceRange>('oneYear');
  const [allocation, setAllocation] = useState<AllocationKey>('asset');

  const { months, value: values, invested } = performanceWindow(data.performance, range);
  // More than a year on the chart: the labels carry the year (`Jan 25`), like the prototype.
  const labels = months.map(
    (month) => monthLabel(month) + (months.length > 12 ? ` ${month.slice(2, 4)}` : ''),
  );
  const openHoldings = data.holdings.filter((h) => h.isOpen);

  const slices =
    allocation === 'asset'
      ? openHoldings
          .map((h) => ({ name: ctx.assetsById.get(h.assetId)?.ticker ?? '', value: h.value }))
          .sort((a, b) => Number(b.value) - Number(a.value))
      : data.allocation[allocation].map((slice) => ({
          ...slice,
          name: slice.name === '' ? t('allocation.none') : sliceName(allocation, slice.name, t),
        }));
  // Accounts linked to the portfolio count as slices too (by account, or as one block).
  const linkedSlices =
    allocation === 'asset'
      ? ctx.linkedAccounts.map((row) => ({
          name: row.groupName ?? row.name,
          value: row.balanceDisplay,
        }))
      : ctx.linkedAccounts.length > 0
        ? [
            {
              name: t('allocation.accountsBlock'),
              value: sumMoney(ctx.linkedAccounts.map((row) => row.balanceDisplay)),
            },
          ]
        : [];
  const merged = new Map<string, number>();
  for (const slice of [...slices, ...linkedSlices]) {
    merged.set(slice.name, (merged.get(slice.name) ?? 0) + Number(slice.value));
  }
  const segments = [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: seriesColor(index),
    }));
  const hasAccounts = ctx.linkedAccounts.length > 0;

  const forecastValues = data.forecast.map((m) => Number(m.value));
  const forecastTotal = sumMoney(data.forecast.map((m) => m.value));
  const forecastAverage = (Number(forecastTotal) / 12).toFixed(2);
  const top = [...openHoldings]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, TOP_POSITIONS);

  /** One line of the gain breakdown: label on the left, the signed amount on the right. */
  const breakdown = (label: string, value: string) => (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 text-right tabular-nums">
        <SignedMoney value={value} currency={cur} />
      </dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('value')}</Eyebrow>
            <b className="text-[34px] font-extrabold leading-[1.15] tracking-[-0.02em]">
              {formatMoney(summary.valueAll, cur)}
            </b>
            <p className="text-xs text-fg-3">
              {t(hasAccounts ? 'valueDetailAccounts' : 'valueDetail', {
                invested: formatMoney(summary.netInvested, cur),
                positions: formatMoney(summary.value, cur),
                cash: formatMoney(
                  hasAccounts ? sumMoney([summary.valueAll, negate(summary.value)]) : summary.cash,
                  cur,
                ),
              })}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-5 gap-y-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>{t('totalGain')}</Eyebrow>
              <b className={`whitespace-nowrap text-lg ${toneClass(summary.profit)}`}>
                {withPlus(formatMoney(summary.profit, cur), summary.profit)}{' '}
                <span className="text-xs">{fractionPct(summary.profitPct, true)}</span>
              </b>
              <dl className="m-0 mt-1 flex flex-col gap-0.5">
                {breakdown(t('capitalGain'), summary.gain)}
                {dividends && breakdown(t('dividendsReceived'), summary.divGross)}
                {dividends && breakdown(t('taxWithheld'), summary.tax)}
                {dividends &&
                  Number(summary.refund) !== 0 &&
                  breakdown(t('taxRefunds'), summary.refund)}
                {Number(summary.realized) !== 0 && breakdown(t('realizedGain'), summary.realized)}
                {breakdown(t('interest'), summary.other)}
              </dl>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>{t('irr')}</Eyebrow>
              {summary.irr === null ? (
                <b className="text-lg text-fg-2">{t('irrNone')}</b>
              ) : (
                <b className={`text-lg ${toneClass(String(summary.irr))}`}>
                  {formatPct(summary.irr * 100, { signed: true })}
                </b>
              )}
              <small className="text-xs text-fg-3">{t('irrHint')}</small>
            </div>
            {dividends && (
              <div className="flex min-w-0 flex-col gap-0.5">
                <Eyebrow>{t('passiveIncome')}</Eyebrow>
                <b className="text-lg">{fractionPct(summary.yld)}</b>
                <small className="text-xs text-fg-3">
                  {t('passiveIncomeDetail', {
                    gross: formatMoney(summary.income, cur),
                    net: formatMoney(data.incomeNet, cur),
                    yoc: fractionPct(summary.yoc),
                  })}
                </small>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>{t('positionsCost')}</Eyebrow>
              <b className="text-lg">{chipMoney(summary.cost, cur)}</b>
              {dividends && (
                <small className="text-xs text-fg-3">
                  {t('positionsCostDetail', { dividends: formatMoney(summary.divs12, cur) })}
                </small>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>{t('cash')}</Eyebrow>
              <b className="text-lg">{formatMoney(summary.cash, cur)}</b>
              {!!portfolioId && ctx.permissions.ops && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-fg-2 hover:text-fg"
                  onClick={() => {
                    open({ kind: 'moveCash' });
                  }}
                >
                  {t('moveCash')}
                  <ArrowRight aria-hidden className="size-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 kpi2:col-span-12">
          <CardHeader
            title={t('performance.title')}
            actions={
              <>
                <ul className="m-0 flex list-none flex-wrap gap-4 p-0 text-sm text-fg-2">
                  <li className="inline-flex items-center gap-1.5">
                    <i
                      aria-hidden
                      className="size-[9px] rounded-full"
                      style={{ background: VALUE_COLOR }}
                    />
                    {t('performance.value')}
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <i
                      aria-hidden
                      className="h-0.5 w-3.5"
                      style={{
                        background: `repeating-linear-gradient(90deg, var(--fg-2) 0 4px, transparent 4px 7px)`,
                      }}
                    />
                    {t('performance.invested')}
                  </li>
                </ul>
                <Segmented
                  label={t('performance.range')}
                  value={range}
                  onChange={setRange}
                  options={RANGES.map((value) => ({
                    value,
                    label: t(`performance.ranges.${value}`),
                  }))}
                />
              </>
            }
          />
          <LineChart
            labels={labels}
            series={[
              { name: t('performance.value'), values, color: VALUE_COLOR },
              {
                name: t('performance.invested'),
                values: invested,
                color: INVESTED_COLOR,
                dash: true,
                step: true,
                fill: false,
              },
            ]}
            currency={cur}
            label={t('performance.title')}
            periodHeader={t('performance.period')}
            empty={t('performance.empty')}
            height={230}
          />
        </Card>
        <Card className="col-span-4 kpi2:col-span-12">
          <CardHeader
            title={t('allocation.title')}
            actions={
              <Select
                compact
                aria-label={t('allocation.byLabel')}
                value={allocation}
                onChange={(event) => {
                  setAllocation(event.target.value as AllocationKey);
                }}
              >
                {ALLOCATIONS.map((key) => (
                  <option key={key} value={key}>
                    {t(`allocation.by.${key}`)}
                  </option>
                ))}
              </Select>
            }
          />
          {segments.length === 0 ? (
            <EmptyState title={t('allocation.empty')} />
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Donut
                segments={segments}
                currency={cur}
                label={t('allocation.title')}
                centerLabel={t(
                  hasAccounts ? 'allocation.centerAssets' : 'allocation.centerPositions',
                )}
                centerValue={String(summary.positions + ctx.linkedAccounts.length)}
                legend="none"
              />
              <ChartLegend
                segments={segments.slice(0, LEGEND_ROWS)}
                currency={cur}
                className="w-full"
              />
            </div>
          )}
        </Card>
      </div>

      {hasAccounts && <LinkedAccountsCard ctx={ctx} />}

      {(top.length > 0 || dividends) && (
        <div className="grid grid-cols-12 gap-4">
          {top.length > 0 && (
            <Card className={dividends ? 'col-span-8 kpi2:col-span-12' : 'col-span-12'}>
              <CardHeader
                title={t('top.title')}
                actions={
                  <Link
                    href={portfoliosPath(
                      poolId,
                      portfolioId,
                      'positions',
                      'asset',
                      ctx.currencyMode,
                    )}
                    className="inline-flex h-7 items-center rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold no-underline"
                  >
                    {t('top.seeAll')}
                  </Link>
                }
              />
              {
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('top.asset')}</Th>
                      <Th numeric>{t('top.price')}</Th>
                      <Th numeric>{t('top.value')}</Th>
                      <Th numeric>{t('top.gain')}</Th>
                      <Th numeric>{t('top.weight')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((h) => {
                      const asset = ctx.assetsById.get(h.assetId);
                      const stale =
                        !!asset?.priceDate &&
                        daysBetween(asset.priceDate, data.asOf) > STALE_PRICE_DAYS;
                      return (
                        <tr key={h.key}>
                          <Td>
                            <AssetCell
                              ticker={asset?.ticker ?? ''}
                              name={asset?.name}
                              type={asset?.type}
                            />
                          </Td>
                          <Td numeric>
                            {formatNumber(h.price)}{' '}
                            <small className="inline text-xs text-fg-3">{h.currency}</small>
                            {stale && (
                              <small className="block text-xs text-warn">{t('top.stale')}</small>
                            )}
                          </Td>
                          <Td numeric>
                            <b>
                              <NativeMoney
                                native={h.valueN}
                                converted={h.value}
                                displayCurrency={cur}
                                currency={h.currency}
                              />
                            </b>
                          </Td>
                          <Td numeric>
                            <NativeMoney
                              native={h.gainN}
                              converted={h.gain}
                              displayCurrency={cur}
                              currency={h.currency}
                              signed
                            />
                            <small className={`block text-xs ${toneClass(h.gain)}`}>
                              {fractionPct(h.gainPct, true)}
                            </small>
                          </Td>
                          <Td numeric>{fractionPct(h.weight)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              }
            </Card>
          )}
          {dividends && (
            <Card className={top.length > 0 ? 'col-span-4 kpi2:col-span-12' : 'col-span-12'}>
              <CardHeader
                title={t('forecast.title')}
                actions={
                  <Link
                    href={portfoliosPath(
                      poolId,
                      portfolioId,
                      'dividends',
                      'asset',
                      ctx.currencyMode,
                    )}
                    className="inline-flex h-7 items-center rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold no-underline"
                  >
                    {t('forecast.calendar')}
                  </Link>
                }
              />
              <BarChart
                labels={data.forecast.map((m) => monthLabel(m.month))}
                values={forecastValues.map(() => 0)}
                forecast={forecastValues}
                currency={cur}
                label={t('forecast.title')}
                forecastNote={t('forecast.note')}
                periodHeader={t('performance.period')}
                empty={t('forecast.empty')}
                height={160}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
                <div className="flex flex-col gap-0.5">
                  <Eyebrow>{t('forecast.next12')}</Eyebrow>
                  <b className="text-xl">{chipMoney(forecastTotal, cur)}</b>
                </div>
                <div className="flex flex-col gap-0.5">
                  <Eyebrow>{t('forecast.monthlyAverage')}</Eyebrow>
                  <b className="text-xl">{chipMoney(forecastAverage, cur)}</b>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function sliceName(
  key: Exclude<AllocationKey, 'asset'>,
  name: string,
  t: ReturnType<typeof useTranslations>,
): string {
  return key === 'type' ? t(`allocation.types.${name}`) : name;
}
