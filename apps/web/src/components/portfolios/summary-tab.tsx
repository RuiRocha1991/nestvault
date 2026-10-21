'use client';

import {
  BarChart,
  Card,
  CardHeader,
  Donut,
  EmptyState,
  Eyebrow,
  formatMoney,
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

import { AssetCell, tickerColor } from '@webapp/components/portfolios/asset-badge';
import { NativeMoney, SignedMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import {
  fractionPct,
  groupByAccount,
  monthLabel,
  portfoliosPath,
  sliceRange,
  sumMoney,
  toneClass,
  withPlus,
  type PerformanceRange,
} from '@webapp/lib/portfolios-view';

type AllocationKey = 'asset' | 'type' | 'sector' | 'region' | 'currency';
const ALLOCATIONS: readonly AllocationKey[] = ['asset', 'type', 'sector', 'region', 'currency'];
const RANGES: readonly PerformanceRange[] = ['sixMonths', 'oneYear', 'threeYears', 'all'];
const TOP_POSITIONS = 6;

/** Mockups 02 and mobile-02: the numbers, the performance chart, allocation, accounts and dividends. */
export function SummaryTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.summary');
  const { summary, data, poolId, portfolioId } = ctx;
  const [range, setRange] = useState<PerformanceRange>('oneYear');
  const [allocation, setAllocation] = useState<AllocationKey>('asset');
  const [grouped, setGrouped] = useState(true);

  const months = sliceRange(data.performance.months, range);
  const values = sliceRange(data.performance.value, range).map(Number);
  const invested = sliceRange(data.performance.invested, range).map(Number);
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
  const segments = slices.map((slice, index) => ({
    name: slice.name,
    value: Number(slice.value),
    color: allocation === 'asset' ? tickerColor(slice.name) : seriesColor(index),
  }));

  const linked = ctx.accounts.filter((a) =>
    portfolioId ? a.portfolioId === portfolioId : a.portfolioId !== null,
  );
  const holderName = (id: string) => ctx.holders.find((h) => h.id === id)?.name ?? '';
  const rows = grouped
    ? groupByAccount(linked.map((a) => ({ ...a, accountId: a.groupName ?? a.id }))).map(
        (group) => ({
          key: group.accountId ?? '',
          accounts: group.rows,
        }),
      )
    : linked.map((a) => ({ key: a.id, accounts: [a] }));

  const forecastValues = data.forecast.map((m) => Number(m.value));
  const forecastTotal = sumMoney(data.forecast.map((m) => m.value));
  const forecastAverage = (Number(forecastTotal) / 12).toFixed(2);
  const top = [...openHoldings]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, TOP_POSITIONS);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid gap-6 md:grid-cols-[1.1fr_1.6fr_1fr_1fr_1fr]">
          <div className="flex flex-col justify-end gap-1">
            <Eyebrow>{t('value')}</Eyebrow>
            <b className="text-[34px] leading-tight tracking-[-0.02em]">
              {formatMoney(summary.valueAll)}
            </b>
            <p className="text-sm text-fg-3">
              {t('valueDetail', {
                invested: formatMoney(summary.netInvested),
                positions: formatMoney(summary.value),
                cash: formatMoney(summary.cash),
              })}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('totalGain')}</Eyebrow>
            <div className="flex items-baseline gap-2">
              <b className={`text-2xl ${toneClass(summary.total)}`}>
                {withPlus(formatMoney(summary.total), summary.total)}
              </b>
              <span className={`text-sm ${toneClass(summary.total)}`}>
                {fractionPct(summary.totalPct, true)}
              </span>
            </div>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm text-fg-2">
              <dt>{t('capitalGain')}</dt>
              <dd className="text-right">
                <SignedMoney value={summary.gain} />
              </dd>
              <dt>{t('dividendsReceived')}</dt>
              <dd className="text-right">
                <SignedMoney value={summary.divs} />
              </dd>
              <dt>{t('taxWithheld')}</dt>
              <dd className="text-right">{formatMoney(summary.tax)}</dd>
              <dt>{t('interest')}</dt>
              <dd className="text-right">
                <SignedMoney value={summary.other} />
              </dd>
            </dl>
            <div className="mt-3 flex flex-col gap-1">
              <Eyebrow>{t('cash')}</Eyebrow>
              <b className="text-xl">{formatMoney(summary.cash)}</b>
              {!!portfolioId && ctx.permissions.ops && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 self-start text-sm font-semibold text-accent-2"
                  onClick={() => {
                    open({ kind: 'moveCash' });
                  }}
                >
                  {t('moveCash')}
                  <ArrowRight aria-hidden className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('irr')}</Eyebrow>
            {summary.irr === null ? (
              <b className="text-2xl text-fg-2">{t('irrNone')}</b>
            ) : (
              <b className={`text-2xl ${toneClass(String(summary.irr))}`}>
                {formatPct(summary.irr * 100, { signed: true })}
              </b>
            )}
            <p className="text-sm text-fg-3">{t('irrHint')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('passiveIncome')}</Eyebrow>
            <b className="text-2xl">{fractionPct(summary.yld)}</b>
            <p className="text-sm text-fg-3">
              {t('passiveIncomeDetail', {
                gross: formatMoney(summary.income),
                net: formatMoney(data.incomeNet),
                yoc: fractionPct(summary.yoc),
              })}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('positionsCost')}</Eyebrow>
            <b className="text-2xl">{formatMoney(summary.cost)}</b>
            <p className="text-sm text-fg-3">
              {t('positionsCostDetail', { dividends: formatMoney(summary.divs12) })}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 max-[1100px]:col-span-12">
          <CardHeader
            title={t('performance.title')}
            actions={
              <Segmented
                label={t('performance.range')}
                value={range}
                onChange={setRange}
                options={RANGES.map((value) => ({
                  value,
                  label: t(`performance.ranges.${value}`),
                }))}
              />
            }
          />
          <LineChart
            labels={months.map(monthLabel)}
            series={[
              { name: t('performance.value'), values },
              { name: t('performance.invested'), values: invested, dash: true },
            ]}
            label={t('performance.title')}
            periodHeader={t('performance.period')}
            empty={t('performance.empty')}
            height={300}
          />
        </Card>
        <Card className="col-span-4 max-[1100px]:col-span-12">
          <CardHeader
            title={t('allocation.title')}
            actions={
              <Select
                aria-label={t('allocation.byLabel')}
                value={allocation}
                className="h-[30px] w-auto"
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
            <Donut
              segments={segments}
              label={t('allocation.title')}
              centerLabel={t(`allocation.center.${allocation}`)}
              centerValue={String(segments.length)}
              legend="below"
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t('accounts.title')}
          actions={
            <>
              <Segmented
                label={t('accounts.view')}
                value={grouped ? 'grouped' : 'all'}
                onChange={(value) => {
                  setGrouped(value === 'grouped');
                }}
                options={[
                  { value: 'grouped', label: t('accounts.grouped') },
                  { value: 'all', label: t('accounts.all') },
                ]}
              />
              <Link
                href={`/${encodeURIComponent(poolId)}/contas`}
                className="inline-flex h-[30px] items-center rounded-sm border border-line-2 bg-panel-2 px-3 text-sm font-semibold no-underline"
              >
                {t('accounts.manage')}
              </Link>
            </>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title={t('accounts.empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('accounts.account')}</Th>
                <Th>{t('accounts.holders')}</Th>
                <Th numeric>{t('accounts.balance')}</Th>
                <Th numeric>{t('accounts.rate')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [first] = row.accounts;
                if (!first) return null;
                const many = row.accounts.length > 1;
                const holders = [...new Set(row.accounts.flatMap((a) => a.holderIds))]
                  .map(holderName)
                  .filter((name) => name !== '')
                  .join(', ');
                return (
                  <tr key={row.key}>
                    <Td>
                      <b className="block font-semibold">
                        {many ? (first.groupName ?? first.name) : first.name}
                      </b>
                      <span className="text-sm text-fg-3">
                        {many
                          ? t('accounts.applications', { count: row.accounts.length })
                          : (first.institution ?? '')}
                      </span>
                    </Td>
                    <Td className="text-fg-2">{holders}</Td>
                    <Td numeric>
                      <b>
                        {many
                          ? formatMoney(sumMoney(row.accounts.map((a) => a.balanceEur)))
                          : formatMoney(first.balance, first.currency)}
                      </b>
                    </Td>
                    <Td numeric>
                      {!many && first.rate ? formatPct(first.rate, { digits: 2 }) : ''}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 max-[1100px]:col-span-12">
          <CardHeader
            title={t('top.title')}
            actions={
              <Link
                href={portfoliosPath(poolId, portfolioId, 'positions')}
                className="inline-flex h-[30px] items-center rounded-sm border border-line-2 bg-panel-2 px-3 text-sm font-semibold no-underline"
              >
                {t('top.seeAll')}
              </Link>
            }
          />
          {top.length === 0 ? (
            <EmptyState title={t('top.empty')} />
          ) : (
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
                  return (
                    <tr key={h.key}>
                      <Td>
                        <AssetCell ticker={asset?.ticker ?? ''} name={asset?.name} />
                      </Td>
                      <Td numeric>{formatMoney(h.price, h.currency)}</Td>
                      <Td numeric>
                        <b>
                          <NativeMoney native={h.valueN} eur={h.value} currency={h.currency} />
                        </b>
                      </Td>
                      <Td numeric>
                        <NativeMoney native={h.gainN} eur={h.gain} currency={h.currency} signed />
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
          )}
        </Card>
        <Card className="col-span-4 max-[1100px]:col-span-12">
          <CardHeader
            title={t('forecast.title')}
            actions={
              <Link
                href={portfoliosPath(poolId, portfolioId, 'dividends')}
                className="inline-flex h-[30px] items-center rounded-sm border border-line-2 bg-panel-2 px-3 text-sm font-semibold no-underline"
              >
                {t('forecast.calendar')}
              </Link>
            }
          />
          <BarChart
            labels={data.forecast.map((m) => monthLabel(m.month))}
            values={forecastValues.map(() => 0)}
            forecast={forecastValues}
            label={t('forecast.title')}
            forecastNote={t('forecast.note')}
            periodHeader={t('performance.period')}
            empty={t('forecast.empty')}
            height={160}
          />
          <div className="flex gap-8">
            <div>
              <Eyebrow>{t('forecast.next12')}</Eyebrow>
              <b className="block text-xl">{formatMoney(forecastTotal)}</b>
            </div>
            <div>
              <Eyebrow>{t('forecast.monthlyAverage')}</Eyebrow>
              <b className="block text-xl">{formatMoney(forecastAverage)}</b>
            </div>
          </div>
        </Card>
      </div>
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
