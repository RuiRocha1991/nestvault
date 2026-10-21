import {
  BarChart,
  Card,
  CardHeader,
  Chip,
  Donut,
  Eyebrow,
  formatMoney,
  formatPct,
  LineChart,
  ProgressBar,
} from '@nestvault/ui';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { categoryMessageKey } from '@webapp/lib/category-name';
import type { CategoryView, SummaryView } from '@webapp/lib/expenses-types';
import {
  budgetRows,
  budgetTotals,
  elapsedPercent,
  monthLabel,
  monthOptions,
  monthShort,
} from '@webapp/lib/expenses-view';

import { MonthSelect } from './month-select';

export interface SummaryTabProps {
  poolId: string;
  summary: SummaryView;
  categories: readonly CategoryView[];
  /** `yyyy-mm-dd` in Lisbon. */
  today: string;
  canWriteCategories: boolean;
}

const INCOME_COLOR = '#3CCB7F';
const EXPENSE_COLOR = '#F2913D';
const OVER_COLOR = 'var(--neg)';
const WARN_COLOR = '#F2913D';

const num = (value: string) => Number(value);

/** The Resumo e orçamento tab (mockup 10, mobile-03): the month in numbers, budgets and history. */
export async function SummaryTab({
  poolId,
  summary,
  categories,
  today,
  canWriteCategories,
}: SummaryTabProps) {
  const [t, tc] = await Promise.all([
    getTranslations('expenses.summary'),
    getTranslations('categories'),
  ]);
  const { flow, month } = summary;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const nameOf = (id: string | null) => {
    const category = id ? byId.get(id) : undefined;
    if (!category) return t('uncategorized');
    if (category.systemKey === null) return category.name ?? '';
    const key = categoryMessageKey(category.systemKey);
    return tc.has(key) ? tc(key) : (category.name ?? category.systemKey);
  };
  const colorOf = (id: string | null) => (id ? byId.get(id)?.color : undefined) ?? '#8C8FB8';

  const rows = budgetRows(categories, summary.categories);
  const totals = budgetTotals(rows);
  const totalPercent = num(totals.budget) > 0 ? (num(totals.spent) / num(totals.budget)) * 100 : 0;
  const elapsed = elapsedPercent(month, today);
  const monthName = monthLabel(month).split(' ')[0]?.toLowerCase() ?? month;
  const savingsRate = flow.savingsRate === null ? null : num(flow.savingsRate) * 100;
  const budgeted = rows.some((row) => row.budget !== null);

  const segments = summary.categories.map((entry) => ({
    name: nameOf(entry.categoryId),
    value: num(entry.value),
    color: colorOf(entry.categoryId),
  }));
  const history = summary.history;
  const labels = history.map((point) => monthShort(point.month));
  const movementsHref = (id: string | null) =>
    `/${poolId}/despesas?tab=movimentos&month=${month}&category=${id ?? 'none'}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <MonthSelect poolId={poolId} month={month} months={monthOptions(month, today)} />
          <Link
            prefetch={false}
            href={`/${poolId}/mes/${month}`}
            className="text-md font-semibold text-accent-2 no-underline hover:underline"
          >
            {t('seeMonth')}
          </Link>
          <p className="ml-auto max-w-xl text-right text-sm text-fg-3 one:ml-0 one:text-left">
            {t('note')}
          </p>
        </div>
        <dl className="m-0 grid grid-cols-4 gap-4 kpi2:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt>
              <Eyebrow>{t('income')}</Eyebrow>
            </dt>
            <dd className="m-0 text-2xl font-bold tabular-nums text-pos">
              {formatMoney(flow.income)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt>
              <Eyebrow>{t('expenses')}</Eyebrow>
            </dt>
            <dd className="m-0 text-2xl font-bold tabular-nums">{formatMoney(flow.expenses)}</dd>
            {budgeted && (
              <span className="text-sm text-fg-3">
                {t('expensesBudget', { amount: formatMoney(totals.budget) })}
              </span>
            )}
            {num(flow.refunds) > 0 && (
              <span className="text-sm text-fg-3">
                {t('refunds', { amount: formatMoney(flow.refunds) })}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <dt>
              <Eyebrow>{t('invested')}</Eyebrow>
            </dt>
            <dd className="m-0 text-2xl font-bold tabular-nums">{formatMoney(flow.invested)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt>
              <Eyebrow>{t('savingsRate')}</Eyebrow>
            </dt>
            <dd className="m-0 text-2xl font-bold tabular-nums">
              {savingsRate === null ? '—' : formatPct(savingsRate)}
            </dd>
            <span className="text-sm text-fg-3">{t('savingsRateHint')}</span>
          </div>
        </dl>
      </Card>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 drawer:grid-cols-[minmax(0,1fr)]">
        <Card className="gap-4">
          <CardHeader
            title={t('budgetTitle', { month: monthName })}
            actions={
              <>
                <Chip>{t('elapsed', { percent: elapsed })}</Chip>
                {canWriteCategories && (
                  <Link
                    prefetch={false}
                    href={`/${poolId}/despesas?tab=categorias`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold text-fg no-underline hover:border-accent-2"
                  >
                    <Pencil aria-hidden className="size-4" />
                    {t('setBudgets')}
                  </Link>
                )}
              </>
            }
          />
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">{t('noBudgets')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {rows.map((row) => {
                const name = nameOf(row.categoryId);
                const color =
                  row.tone === 'over'
                    ? OVER_COLOR
                    : row.tone === 'warn'
                      ? WARN_COLOR
                      : colorOf(row.categoryId);
                const over = row.remaining !== null && row.remaining.startsWith('-');
                return (
                  <li key={row.categoryId ?? 'none'} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <i
                        aria-hidden
                        className="size-2.5 shrink-0 self-center rounded-[3px]"
                        style={{ background: colorOf(row.categoryId) }}
                      />
                      <Link
                        prefetch={false}
                        href={movementsHref(row.categoryId)}
                        className="mr-auto min-w-0 truncate text-fg no-underline hover:underline"
                      >
                        {name}
                      </Link>
                      <b className="tabular-nums" style={row.tone === 'ok' ? undefined : { color }}>
                        {formatMoney(row.value)}
                      </b>
                      <span className="text-sm tabular-nums text-fg-3">
                        {row.budget === null || row.remaining === null
                          ? t('noBudgetLine')
                          : over
                            ? t('budgetOver', {
                                budget: formatMoney(row.budget),
                                over: formatMoney(row.remaining.slice(1)),
                              })
                            : t('budgetLine', {
                                budget: formatMoney(row.budget),
                                remaining: formatMoney(row.remaining),
                              })}
                      </span>
                    </div>
                    {row.percent !== null && (
                      <ProgressBar
                        thick
                        value={row.percent}
                        color={color}
                        label={t('budgetBar', { name })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {budgeted && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <b className="mr-auto text-md">{t('budgetTotal')}</b>
                <b className="text-lg tabular-nums">{formatMoney(totals.spent)}</b>
                <span className="text-sm tabular-nums text-fg-3">
                  {t('budgetOf', { budget: formatMoney(totals.budget) })}
                </span>
              </div>
              <ProgressBar thick warm value={totalPercent} label={t('budgetTotalBar')} />
            </div>
          )}
        </Card>

        <Card className="gap-4">
          <CardHeader title={t('byCategory')} />
          {segments.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">{t('chartEmpty')}</p>
          ) : (
            <Donut
              segments={segments}
              label={t('byCategoryChart')}
              centerLabel={t('total')}
              centerValue={formatMoney(flow.expenses)}
              size={170}
              legend="right"
              className="w-full"
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 drawer:grid-cols-[minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t('incomeVsExpenses')}
            actions={
              <span className="flex gap-3 text-sm text-fg-2">
                <Chip dotColor={INCOME_COLOR}>{t('income')}</Chip>
                <Chip dotColor={EXPENSE_COLOR}>{t('expenses')}</Chip>
              </span>
            }
          />
          <LineChart
            labels={labels}
            label={t('incomeVsExpensesChart')}
            empty={t('chartEmpty')}
            periodHeader={t('period')}
            series={[
              {
                name: t('income'),
                values: history.map((point) => num(point.income)),
                color: INCOME_COLOR,
                fill: false,
              },
              {
                name: t('expenses'),
                values: history.map((point) => num(point.expenses)),
                color: EXPENSE_COLOR,
              },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t('monthlyExpenses')} />
          <BarChart
            labels={labels}
            values={history.map((point) => Math.max(0, num(point.expenses)))}
            highlight={history.length - 1}
            label={t('monthlyExpensesChart')}
            empty={t('chartEmpty')}
            periodHeader={t('period')}
          />
        </Card>
      </div>
    </div>
  );
}
