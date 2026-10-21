'use client';

import { BarChart, Card, CardHeader, cn, LineChart } from '@nestvault/ui';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { TimelineMonth } from '@webapp/lib/month-types';
import { monthHref, monthLabel, shortMonthLabel } from '@webapp/lib/month-view';

/**
 * The last 12 months ending with the reviewed one: net worth, expenses and a row of links to each
 * month; a speech bubble marks the months that have a note.
 */
export function MonthTimeline({
  poolId,
  month,
  timeline,
}: {
  poolId: string;
  month: string;
  timeline: readonly TimelineMonth[];
}) {
  const t = useTranslations('months.timeline');
  const labels = timeline.map((m) => shortMonthLabel(m.month));
  const current = timeline.findIndex((m) => m.month === month);

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChart
          labels={labels}
          series={[{ name: t('netWorth'), values: timeline.map((m) => Number(m.netWorth)) }]}
          label={t('netWorthChart')}
          empty={t('empty')}
          periodHeader={t('period')}
        />
        <BarChart
          labels={labels}
          values={timeline.map((m) => Number(m.expenses))}
          highlight={current}
          label={t('expensesChart')}
          empty={t('empty')}
          periodHeader={t('period')}
        />
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label={t('months')}>
        {timeline.map((m) => (
          <li key={m.month}>
            <Link
              href={monthHref(poolId, m.month)}
              aria-current={m.month === month ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-pill px-3 text-sm',
                m.month === month
                  ? 'bg-accent-soft text-accent-2'
                  : 'bg-panel-2 text-fg-2 hover:text-fg',
              )}
            >
              {monthLabel(m.month)}
              {m.hasNote && (
                <>
                  <MessageSquare aria-hidden className="size-3.5" />
                  <span className="sr-only">{t('hasNote')}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
