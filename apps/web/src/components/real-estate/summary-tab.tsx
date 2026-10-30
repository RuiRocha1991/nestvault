import {
  Card,
  CardHeader,
  Chip,
  Donut,
  EmptyState,
  ProgressBar,
  StackedBarChart,
  Table,
  Td,
  Th,
  formatDate,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { EventLine } from '@webapp/components/real-estate/event-line';
import { Stat } from '@webapp/components/real-estate/parts';
import {
  loanFacts,
  monthYearOf,
  yearBars,
  type PropertyFigures,
} from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

/** Data colours of the money donut (design system §3), in the order of `spentBreakdown`. */
const SLICE_COLORS: Record<string, string> = {
  capitalPaid: '#9D6BFF',
  downPayment: '#6C5CFF',
  works: '#2BC6B4',
  interest: '#F2913D',
  insurances: '#3BA7F2',
  acquisitionCosts: '#F2C43D',
  feesAndTax: '#8C8FB8',
};
const CAPITAL_COLOR = '#9D6BFF';
const INTEREST_COLOR = '#F2913D';
const RECENT_EVENTS = 3;

/** Mockups 28 and mobile-07: equity, loan progress, the years, where the money went, what is next. */
export function SummaryTab({
  figures,
  bundle,
}: {
  figures: PropertyFigures;
  bundle: LoanBundle | undefined;
}) {
  const t = useTranslations('realEstate.summary');
  const tSpent = useTranslations('realEstate.spent');
  const facts = bundle ? loanFacts(bundle) : null;
  const bars = bundle ? yearBars(bundle) : [];
  const events = bundle ? [...bundle.events].reverse().slice(0, RECENT_EVENTS) : [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
              {t('equity')}
            </span>
            <b className="text-[34px] font-extrabold leading-[1.15] tracking-[-0.02em] tabular-nums">
              {figures.equity === null ? '—' : formatMoney(figures.equity)}
            </b>
            <p className="text-xs text-fg-3">{t('equityHint')}</p>
            {!!facts && (
              <p className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-pill bg-panel-2 px-2.5 py-1 text-pos">
                  {t('repaidChip', { pct: formatPct(figures.repaidPct) })}
                </span>
                <span className="rounded-pill bg-panel-2 px-2.5 py-1 text-fg-2">
                  {t('countChip', { paid: facts.paidCount, total: facts.totalCount })}
                </span>
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label={t('value')}
              hint={
                figures.valueDate
                  ? t('valueHint', { date: monthYearOf(figures.valueDate) })
                  : undefined
              }
            >
              {figures.value === null ? '—' : formatMoney(figures.value)}
            </Stat>
            <Stat
              label={t('outstanding')}
              tone="neg"
              hint={facts?.endDate ? t('endsIn', { date: monthYearOf(facts.endDate) }) : undefined}
            >
              {formatMoney(figures.outstanding)}
            </Stat>
            <Stat label={t('capitalPaid')} hint={t('capitalPaidHint')}>
              {formatMoney(figures.capitalPaid)}
            </Stat>
            <Stat
              label={t('payment')}
              hint={
                bundle
                  ? t('rateHint', { rate: formatPct(bundle.loan.annualRate, { digits: 2 }) })
                  : undefined
              }
            >
              {facts ? formatMoney(facts.payment) : '—'}
            </Stat>
            <Stat label={t('totalInvested')} hint={t('totalInvestedHint')}>
              {formatMoney(figures.spent.totalInvested)}
            </Stat>
            <Stat label={t('costOfCredit')} hint={t('costOfCreditHint')}>
              {formatMoney(figures.spent.costOfCredit)}
            </Stat>
          </div>
        </div>
      </Card>

      {!!bundle && (
        <Card>
          <CardHeader
            title={t('loanTitle', { name: bundle.loan.name })}
            subtitle={t('loanText', {
              principal: formatMoney(bundle.loan.principal),
              months: bundle.loan.termMonths,
              date: monthYearOf(bundle.loan.startDate),
            })}
          />
          <ProgressBar value={Number(figures.repaidPct)} label={t('progress')} thick />
          <div className="flex justify-between gap-3 text-sm">
            <span>
              <b>{formatMoney(figures.capitalPaid)}</b>{' '}
              {t('paidPct', { pct: formatPct(figures.repaidPct) })}
            </span>
            <span>
              <b>{formatMoney(figures.outstanding)}</b> {t('left')}
            </span>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('yearsTitle')} subtitle={t('yearsText')} />
          <p className="flex gap-4 text-xs text-fg-2">
            <Chip dotColor={CAPITAL_COLOR}>{t('capital')}</Chip>
            <Chip dotColor={INTEREST_COLOR}>{t('interest')}</Chip>
          </p>
          <StackedBarChart
            labels={bars.map((bar) => bar.label)}
            series={[
              { name: t('capital'), color: CAPITAL_COLOR, values: bars.map((bar) => bar.capital) },
              {
                name: t('interest'),
                color: INTEREST_COLOR,
                values: bars.map((bar) => bar.interest),
              },
            ]}
            faded={new Set(bars.flatMap((bar, index) => (bar.projected ? [index] : [])))}
            labelEvery={5}
            label={t('yearsLabel')}
            periodHeader={t('year')}
            empty={t('noLoan')}
          />
        </Card>
        <Card>
          <CardHeader title={t('moneyTitle')} />
          <Donut
            segments={figures.spent.slices.map((slice) => ({
              name: tSpent(slice.key),
              value: Number(slice.amount),
              color: SLICE_COLORS[slice.key] ?? '#8C8FB8',
            }))}
            centerLabel={t('totalSpent')}
            centerValue={formatMoney(figures.spent.totalSpent)}
            label={t('moneyLabel')}
            legend="below"
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('nextTitle')} />
          {facts && facts.upcoming.length > 0 ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('number')}</Th>
                    <Th>{t('date')}</Th>
                    <Th numeric>{t('capital')}</Th>
                    <Th numeric>{t('interest')}</Th>
                    <Th numeric>{t('insurances')}</Th>
                    <Th numeric>{t('total')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {facts.upcoming.map((row) => (
                    <tr key={row.number}>
                      <Td>{row.number}</Td>
                      <Td>{formatDate(row.dueDate)}</Td>
                      <Td numeric>{formatMoney(row.capital)}</Td>
                      <Td numeric>{formatMoney(row.interest)}</Td>
                      <Td numeric>{formatMoney(row.extras)}</Td>
                      <Td numeric>
                        <b>{formatMoney(row.total)}</b>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-xs text-fg-3">{t('projectedNote')}</p>
            </>
          ) : (
            <EmptyState title={t('noUpcoming')} />
          )}
        </Card>
        <Card>
          <CardHeader title={t('recentTitle')} />
          {events.length > 0 ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {events.map((event) => (
                <EventLine key={event.id} event={event} />
              ))}
            </ul>
          ) : (
            <EmptyState title={t('noEvents')} />
          )}
        </Card>
      </div>
    </div>
  );
}
