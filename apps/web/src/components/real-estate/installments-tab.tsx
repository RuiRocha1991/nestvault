'use client';

import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Segmented,
  Select,
  Table,
  Td,
  Th,
  formatDate,
  formatMoney,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Stat } from '@webapp/components/real-estate/parts';
import {
  installmentRows,
  summarizeInstallments,
  type InstallmentRow,
} from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

type StatusFilter = 'all' | 'paid' | 'projected';

/**
 * Mockup 29: the installments with a status and year filter, a summary of the period and a totals
 * row. Columns are fixed for now; the configurable columns of mockup 45 are NES-104, which should
 * build on `installmentRows` / `summarizeInstallments` and replace `extras` by one column per field.
 */
export function InstallmentsTab({
  bundle,
  today,
}: {
  bundle: LoanBundle | undefined;
  /** Today in Lisbon (`yyyy-mm-dd`): the year the filter starts on. */
  today: string;
}) {
  const t = useTranslations('realEstate.installments');
  const rows = useMemo(() => (bundle ? installmentRows(bundle) : []), [bundle]);
  const years = useMemo(
    () => [...new Set(rows.map((row) => row.dueDate.slice(0, 4)))].sort(),
    [rows],
  );
  const [status, setStatus] = useState<StatusFilter>('all');
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState(years.includes(thisYear) ? thisYear : (years[0] ?? ''));

  if (!bundle || rows.length === 0) {
    return (
      <Card>
        <EmptyState title={t('empty')} />
      </Card>
    );
  }

  const shown = rows.filter(
    (row: InstallmentRow) =>
      (status === 'all' || row.status === status) && (!year || row.dueDate.startsWith(year)),
  );
  const summary = summarizeInstallments(shown);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('summaryTitle', { year: year || t('allYears') })}
          subtitle={t('summaryText', { paid: summary.paid, projected: summary.projected })}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label={t('capital')}>{formatMoney(summary.capital)}</Stat>
          <Stat label={t('interest')}>{formatMoney(summary.interest)}</Stat>
          <Stat label={t('extras')}>{formatMoney(summary.extras)}</Stat>
          <Stat label={t('total')}>{formatMoney(summary.total)}</Stat>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<StatusFilter>
            label={t('statusFilter')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('all') },
              { value: 'paid', label: t('paid') },
              { value: 'projected', label: t('projected') },
            ]}
          />
          <Select
            compact
            aria-label={t('yearFilter')}
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
            }}
          >
            <option value="">{t('allYears')}</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {t('yearOption', { year: value })}
              </option>
            ))}
          </Select>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t('number')}</Th>
              <Th>{t('date')}</Th>
              <Th numeric>{t('capital')}</Th>
              <Th numeric>{t('interest')}</Th>
              <Th numeric>{t('extras')}</Th>
              <Th numeric>{t('total')}</Th>
              <Th numeric>{t('remaining')}</Th>
              <Th>{t('state')}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.number} className={row.status === 'projected' ? 'text-fg-2' : undefined}>
                <Td>{row.number}</Td>
                <Td>{formatDate(row.dueDate)}</Td>
                <Td numeric>{formatMoney(row.capital)}</Td>
                <Td numeric>{formatMoney(row.interest)}</Td>
                <Td numeric>{Number(row.extras) === 0 ? '—' : formatMoney(row.extras)}</Td>
                <Td numeric>
                  <b>{formatMoney(row.total)}</b>
                </Td>
                <Td numeric>{row.remaining}</Td>
                <Td>
                  <Chip tone={row.status === 'paid' ? 'pos' : 'default'}>
                    {t(row.status === 'paid' ? 'statusPaid' : 'statusProjected')}
                  </Chip>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Td className="font-bold">{t('totalRow')}</Td>
              <Td />
              <Td numeric className="font-bold">
                {formatMoney(summary.capital)}
              </Td>
              <Td numeric className="font-bold">
                {formatMoney(summary.interest)}
              </Td>
              <Td numeric className="font-bold">
                {formatMoney(summary.extras)}
              </Td>
              <Td numeric className="font-bold">
                {formatMoney(summary.total)}
              </Td>
              <Td />
              <Td />
            </tr>
          </tfoot>
        </Table>
        <p className="text-xs text-fg-3">{t('note')}</p>
      </Card>
    </div>
  );
}
