import { dec, sum, toPlain } from '@nestvault/domain/browser';
import {
  Card,
  CardHeader,
  EmptyState,
  LineChart,
  Table,
  Td,
  Th,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { EventLine } from '@webapp/components/real-estate/event-line';
import { KeyRow } from '@webapp/components/real-estate/parts';
import { monthYearOf, yearPeriod } from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

const dash = (value: string | undefined) =>
  !value || Number(value) === 0 ? '—' : formatMoney(value);

/** Mockup 30: what was paid per contract year, the rate over time and the events. */
export function EventsTab({ bundle }: { bundle: LoanBundle | undefined }) {
  const t = useTranslations('realEstate.eventsTab');
  if (!bundle) {
    return (
      <Card>
        <EmptyState title={t('noLoan')} />
      </Card>
    );
  }
  const { loan, schedule, events, review } = bundle;
  const years = schedule.byYear;
  const field = (row: (typeof years)[number], key: string) => row.fields[key];
  const total = (pick: (row: (typeof years)[number]) => string | undefined) =>
    toPlain(sum(years.map((row) => pick(row) ?? 0)));

  const rows = schedule.schedule;
  const rates = rows.map((row) => Number(row.annualRate));
  const labels = rows.map((row) => monthYearOf(row.dueDate));
  const timeline = [...events].reverse();
  const last = rows.at(-1);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('yearsTitle')} subtitle={t('yearsText')} />
        {years.length === 0 ? (
          <EmptyState title={t('noInstallments')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('year')}</Th>
                <Th>{t('period')}</Th>
                <Th numeric>{t('capital')}</Th>
                <Th numeric>{t('interest')}</Th>
                <Th numeric>{t('fees')}</Th>
                <Th numeric>{t('stampTax')}</Th>
                <Th numeric>{t('lifeInsurance')}</Th>
                <Th numeric>{t('homeInsurance')}</Th>
                <Th numeric>{t('creditInsurance')}</Th>
                <Th numeric>{t('total')}</Th>
              </tr>
            </thead>
            <tbody>
              {years.map((row) => {
                const period = yearPeriod(loan.firstDueDate, row.year);
                return (
                  <tr key={row.year}>
                    <Td className="font-bold">{t('yearLabel', { year: row.year })}</Td>
                    <Td className="whitespace-nowrap">
                      {`${monthYearOf(`${period.from}-01`)} – ${monthYearOf(`${period.to}-01`)}`}
                      {row.count < 12 && (
                        <span className="ml-1 text-xs text-fg-3">
                          {t('partial', { count: row.count })}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{formatMoney(row.capital)}</Td>
                    <Td numeric>{formatMoney(row.interest)}</Td>
                    <Td numeric>{dash(field(row, 'fees'))}</Td>
                    <Td numeric>{dash(field(row, 'stampTax'))}</Td>
                    <Td numeric>{dash(field(row, 'lifeInsurance'))}</Td>
                    <Td numeric>{dash(field(row, 'homeInsurance'))}</Td>
                    <Td numeric>{dash(field(row, 'creditInsurance'))}</Td>
                    <Td numeric className="font-bold">
                      {formatMoney(row.total)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td className="font-bold" colSpan={2}>
                  {t('totalRow')}
                </Td>
                <Td numeric className="font-bold">
                  {formatMoney(total((row) => row.capital))}
                </Td>
                <Td numeric className="font-bold">
                  {formatMoney(total((row) => row.interest))}
                </Td>
                {(
                  ['fees', 'stampTax', 'lifeInsurance', 'homeInsurance', 'creditInsurance'] as const
                ).map((key) => (
                  <Td key={key} numeric className="font-bold">
                    {dash(total((row) => field(row, key)))}
                  </Td>
                ))}
                <Td numeric className="font-bold">
                  {formatMoney(total((row) => row.total))}
                </Td>
              </tr>
            </tfoot>
          </Table>
        )}
        {Number(loan.prepaid) > 0 && (
          <p className="text-xs text-fg-3">
            {t('prepaidNote', { amount: formatMoney(loan.prepaid) })}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('rateTitle')} subtitle={t('rateText')} />
          <LineChart
            labels={labels}
            series={[{ name: t('nominalRate'), values: rates, step: true, color: '#F2913D' }]}
            formatValue={(value) => formatPct(value, { digits: 2 })}
            label={t('rateLabel')}
            periodHeader={t('month')}
            empty={t('noInstallments')}
          />
          <dl className="flex flex-col gap-1.5">
            <KeyRow label={t('currentRate')} strong>
              {formatPct(loan.annualRate, { digits: 2 })}
              {!!loan.rateIndex && !!review?.indexValue && (
                <span className="ml-1 text-xs text-fg-3">
                  {t('indexPlusSpread', {
                    index: formatPct(review.indexValue, { digits: 2 }),
                    spread: formatPct(dec(loan.spread ?? 0).toString(), { digits: 2 }),
                  })}
                </span>
              )}
            </KeyRow>
            {!!review?.nextReviewDate && (
              <KeyRow label={t('nextReview')}>{monthYearOf(review.nextReviewDate)}</KeyRow>
            )}
            <KeyRow label={t('left')}>
              {loan.remainingInstallments}
              {!!last && (
                <span className="ml-1 text-xs text-fg-3">
                  {t('endsIn', { date: monthYearOf(last.dueDate) })}
                </span>
              )}
            </KeyRow>
          </dl>
        </Card>
        <Card>
          <CardHeader title={t('timelineTitle')} />
          <ul className="m-0 flex list-none flex-col p-0">
            {timeline.map((event) => (
              <EventLine key={event.id} event={event} />
            ))}
            <EventLine loan={loan} />
          </ul>
        </Card>
      </div>
    </div>
  );
}
