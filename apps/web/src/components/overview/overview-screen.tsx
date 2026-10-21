import {
  BarChart,
  Card,
  CardHeader,
  Donut,
  EmptyState,
  LineChart,
  ProgressBar,
  Sparkline,
  cn,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  deltaTone,
  goalTone,
  monthKeyOf,
  topCategories,
  type CategorySlice,
  type OverviewData,
} from '@webapp/lib/overview-view';

import { OverviewHeader, type HolderChip } from './overview-header';
import { RangeSelect } from './range-select';

export interface OverviewScreenProps {
  poolId: string;
  data: OverviewData;
  holders: readonly HolderChip[];
  /** What the caller may do; the services enforce it, this only hides the buttons. */
  can: { addTransaction: boolean; addPortfolio: boolean; addAccount: boolean };
}

const linkButton =
  'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold text-fg no-underline hover:border-accent-2 [&_svg]:size-4';
const primaryLink =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-accent bg-accent px-3.5 text-md font-semibold text-on-accent no-underline hover:border-accent-2 hover:bg-accent-2 [&_svg]:size-4';

const TONE = { pos: 'text-pos', neg: 'text-neg', warn: 'text-warn', muted: 'text-fg-3' } as const;

/** `↑0,2%` in green or red, with what it is measured against. */
function Delta({
  value,
  inverse = false,
  note,
}: {
  value: string;
  inverse?: boolean;
  note: string;
}) {
  const number = Number(value);
  const tone = deltaTone(number, inverse);
  return (
    <>
      <span className={cn('inline-flex items-center gap-0.5 text-sm font-semibold', TONE[tone])}>
        {number >= 0 ? (
          <ArrowUp aria-hidden className="size-3" />
        ) : (
          <ArrowDown aria-hidden className="size-3" />
        )}
        {formatPct(Math.abs(number))}
      </span>{' '}
      <span className="text-sm text-fg-3">{note}</span>
    </>
  );
}

function KpiCard({
  title,
  value,
  detail,
  spark,
  from,
  to,
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  spark: readonly string[];
  from: string;
  to: string;
}) {
  return (
    <Card className="relative col-span-3 min-h-[118px] gap-0 overflow-hidden kpi2:col-span-6 one:col-span-12">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-0.5 whitespace-nowrap text-xl font-bold tracking-[-0.01em]">{value}</div>
      <div className="relative z-10 mb-4 mt-1">{detail}</div>
      <Sparkline
        values={spark.map(Number)}
        from={from}
        to={to}
        className="pointer-events-none absolute bottom-0 right-0 h-16 w-1/2"
      />
    </Card>
  );
}

export function OverviewScreen({ poolId, data, holders, can }: OverviewScreenProps) {
  const t = useTranslations('overview');
  const tShell = useTranslations('nav.items');
  const tCategories = useTranslations('categories');

  const header = (
    <OverviewHeader
      poolId={poolId}
      title={tShell('overview')}
      holders={holders}
      canAddTransaction={can.addTransaction}
    />
  );

  if (data.empty) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            title={t('welcomeTitle')}
            description={t('welcomeText')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {can.addAccount && (
                  <Link href={`/${poolId}/contas`} className={primaryLink}>
                    <Plus aria-hidden />
                    {t('createAccount')}
                  </Link>
                )}
                {can.addTransaction && (
                  <Link
                    href={`/${poolId}/despesas`}
                    className={linkButton.replace('h-7', 'h-[34px]')}
                  >
                    {t('importStatement')}
                  </Link>
                )}
              </div>
            }
          />
        </Card>
      </>
    );
  }

  const { kpis, evolution } = data;
  const monthLabel = (month: string) => t(`monthsShort.${monthKeyOf(month)}`);
  const money0 = (value: string) => formatMoney(value, 'EUR', { digits: 0 });
  const slices = topCategories(data.expenses.categories);
  const sliceName = (slice: CategorySlice) => {
    if (slice.kind === 'others') return t('expenses.others');
    if (slice.kind === 'uncategorized') return t('expenses.uncategorized');
    return slice.messageKey ? tCategories(slice.messageKey) : (slice.name ?? '');
  };

  const income = kpis.passiveIncome;
  const interest = Number(income.interest12) > 0 ? income.interest12 : null;
  const budgetUsed = kpis.monthExpenses.budgetUsedPct;
  const forecast = data.dividends.values.map(Number);

  return (
    <>
      {header}
      <div className="grid grid-cols-12 gap-4">
        <KpiCard
          title={t('kpi.netWorth')}
          value={money0(kpis.netWorth.value)}
          detail={<Delta value={kpis.netWorth.changePct} note={t('kpi.vsPreviousMonth')} />}
          spark={kpis.netWorth.spark}
          from="#F2913D"
          to="#E5424D"
        />
        <KpiCard
          title={t('kpi.investments')}
          value={money0(kpis.investments.value)}
          detail={<Delta value={kpis.investments.returnPct} note={t('kpi.totalReturn')} />}
          spark={kpis.investments.spark}
          from="#3BA7F2"
          to="#6C5CFF"
        />
        <KpiCard
          title={t('kpi.passiveIncome')}
          value={
            <>
              {formatMoney(income.annual)}{' '}
              <small className="text-sm font-medium text-fg-3">{t('kpi.perYear')}</small>
            </>
          }
          detail={
            <span className="text-sm font-semibold text-fg-3">
              {t('kpi.incomeDetail', {
                monthly: formatMoney(income.monthly),
                yield: formatPct(income.yieldPct),
              })}
              {interest !== null && t('kpi.interest12', { interest: formatMoney(interest) })}
            </span>
          }
          spark={income.spark}
          from="#2BC6B4"
          to="#3BA7F2"
        />
        <KpiCard
          title={t('kpi.monthExpenses')}
          value={money0(kpis.monthExpenses.value)}
          detail={
            budgetUsed === null ? (
              <Delta value={kpis.monthExpenses.changePct} inverse note={t('kpi.vsPreviousMonth')} />
            ) : (
              <span
                className={cn(
                  'text-sm font-semibold',
                  Number(kpis.monthExpenses.value) > Number(kpis.monthExpenses.budget)
                    ? 'text-neg'
                    : 'text-fg-3',
                )}
              >
                {t('kpi.ofBudget', { percent: formatPct(budgetUsed, { digits: 0 }) })}
              </span>
            )
          }
          spark={kpis.monthExpenses.spark}
          from="#9D6BFF"
          to="#6A2BD9"
        />

        <Card className="col-span-8 kpi2:col-span-12">
          <CardHeader
            title={t('evolution.title')}
            headingLevel={3}
            actions={
              <>
                <span className="inline-flex items-center gap-4 text-sm text-fg-2">
                  <span className="inline-flex items-center gap-1.5">
                    <i aria-hidden className="size-[9px] rounded-full bg-[#9D6BFF]" />
                    {t('evolution.total')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i aria-hidden className="size-[9px] rounded-full bg-[#3BA7F2]" />
                    {t('evolution.investments')}
                  </span>
                </span>
                <RangeSelect value={data.range} />
              </>
            }
          />
          <LineChart
            labels={evolution.months.map(monthLabel)}
            series={[
              { name: t('evolution.total'), color: '#9D6BFF', values: evolution.total.map(Number) },
              {
                name: t('evolution.investments'),
                color: '#3BA7F2',
                values: evolution.investments.map(Number),
              },
            ]}
            label={t('evolution.chartLabel')}
            periodHeader={t('evolution.periodHeader')}
            empty={t('evolution.empty')}
            height={250}
          />
        </Card>

        <Card className="col-span-4 kpi2:col-span-12">
          <CardHeader
            title={t('goals.title')}
            headingLevel={3}
            actions={
              <Link href={`/${poolId}/objetivos`} className={linkButton}>
                {t('goals.seeAll')}
              </Link>
            }
          />
          {data.goals.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">{t('goals.empty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {data.goals.map((goal) => (
                <li
                  key={goal.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3"
                >
                  <span className="truncate text-sm text-fg-2">{goal.name}</span>
                  <b className="text-lg font-bold">{formatPct(goal.progress, { digits: 0 })}</b>
                  <span className={cn('text-xs', TONE[goalTone(goal.status)])}>
                    {t(
                      `goals.status.${goal.status.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())}`,
                      {
                        month: goal.etaMonth ? monthLabel(goal.etaMonth) : '',
                      },
                    )}
                  </span>
                  <ProgressBar
                    value={Number(goal.progress)}
                    label={t('goals.progress', { name: goal.name })}
                    color={goal.color}
                    thick
                    className="col-span-3"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-4 kpi2:col-span-6 one:col-span-12">
          <CardHeader
            title={t('portfolios.title')}
            headingLevel={3}
            actions={
              can.addPortfolio && (
                <Link href={`/${poolId}/portfolios?novo=1`} className={linkButton}>
                  <Plus aria-hidden />
                  {t('portfolios.new')}
                </Link>
              )
            }
          />
          {data.portfolios.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">{t('portfolios.empty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {data.portfolios.map((portfolio) => {
                const tone = Number(portfolio.returnPct) >= 0 ? 'text-pos' : 'text-neg';
                return (
                  <li key={portfolio.id}>
                    <Link
                      href={`/${poolId}/portfolios`}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-transparent bg-inset px-3 py-2.5 text-fg no-underline hover:border-accent-2"
                    >
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <i
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[3px]"
                          style={{ background: portfolio.color }}
                        />
                        <span className="truncate">{portfolio.name}</span>
                      </span>
                      <span className="flex flex-col text-right text-xs">
                        <b className="text-md tabular-nums">
                          {formatMoney(portfolio.value, portfolio.currency, { digits: 0 })}
                        </b>
                        <span className={tone}>
                          {formatPct(portfolio.returnPct, { signed: true })}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="col-span-4 kpi2:col-span-6 one:col-span-12">
          <CardHeader
            title={t('expenses.title')}
            headingLevel={3}
            actions={
              <Link href={`/${poolId}/despesas`} className={linkButton}>
                {t('expenses.detail')}
              </Link>
            }
          />
          {slices.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">{t('expenses.empty')}</p>
          ) : (
            <Donut
              segments={slices.map((slice) => ({
                name: sliceName(slice),
                value: slice.value,
                color: slice.color,
              }))}
              label={t('expenses.chartLabel')}
              centerLabel={monthLabel(data.expenses.month)}
              centerValue={formatMoney(data.expenses.total)}
              size={136}
              stroke={14}
              legend="below"
              className="!items-stretch"
            />
          )}
        </Card>

        <Card className="col-span-4 kpi2:col-span-12">
          <CardHeader
            title={t('dividends.title')}
            headingLevel={3}
            actions={
              <Link href={`/${poolId}/portfolios`} className={linkButton}>
                {t('dividends.calendar')}
              </Link>
            }
          />
          <BarChart
            labels={data.dividends.months.map(monthLabel)}
            values={forecast.map(() => 0)}
            forecast={forecast}
            highlight={0}
            label={t('dividends.chartLabel')}
            periodHeader={t('dividends.periodHeader')}
            empty={t('dividends.empty')}
            height={150}
          />
          <span className="text-sm text-fg-3">
            {t('dividends.forecast')}{' '}
            <b className="text-fg-2">{formatMoney(data.dividends.total)}</b>
          </span>
        </Card>
      </div>
    </>
  );
}
