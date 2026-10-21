'use client';

import { Card, Eyebrow, formatMoney, formatPct } from '@nestvault/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { MonthCategories } from '@webapp/components/months/month-categories';
import { MonthNotable } from '@webapp/components/months/month-notable';
import { MonthNoteCard } from '@webapp/components/months/month-note-card';
import { MonthOperations } from '@webapp/components/months/month-operations';
import { MonthTimeline } from '@webapp/components/months/month-timeline';
import type { CategoryOption, MemberOption, MonthNote, MonthReview } from '@webapp/lib/month-types';
import { monthHref, monthTitle } from '@webapp/lib/month-view';
import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

const ARROW =
  'inline-flex size-9 items-center justify-center rounded-md bg-panel text-fg-2 hover:text-fg';

export interface MonthReviewScreenProps {
  poolId: string;
  review: MonthReview;
  categories: readonly CategoryOption[];
  members: readonly MemberOption[];
  canWriteNotes: boolean;
}

/**
 * Mockup of the monthly review: the month's numbers, the expenses by category, notable
 * transactions, investment operations, the month note and a 12-month timeline. Previous and next
 * month are links, so the month is always in the URL.
 */
export function MonthReviewScreen({
  poolId,
  review,
  categories,
  members,
  canWriteNotes,
}: MonthReviewScreenProps) {
  const t = useTranslations('months');
  const [note, setNote] = useState<MonthNote>(review.note);
  const timeline = review.timeline.map((m) =>
    m.month === review.month ? { ...m, hasNote: (note.body ?? '').trim() !== '' } : m,
  );

  const kpis = [
    { key: 'income', value: review.income, tone: false },
    { key: 'expenses', value: review.expenses, tone: false },
    { key: 'savings', value: review.savings, tone: true },
    { key: 'netWorthChange', value: review.netWorthChange, tone: true },
    { key: 'invested', value: review.invested, tone: false },
    { key: 'dividends', value: review.dividendsReceived, tone: false },
    { key: 'interest', value: review.interestReceived, tone: false },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('navLabel')} className="flex flex-wrap items-center gap-2">
        <Link
          href={monthHref(poolId, review.previousMonth)}
          aria-label={t('previous')}
          className={ARROW}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
        <h2 className="text-xl font-semibold" aria-live="polite">
          {monthTitle(review.month)}
        </h2>
        {review.nextMonth === null ? (
          <span aria-disabled="true" aria-label={t('next')} className={`${ARROW} opacity-40`}>
            <ChevronRight aria-hidden className="size-4" />
          </span>
        ) : (
          <Link href={monthHref(poolId, review.nextMonth)} aria-label={t('next')} className={ARROW}>
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </nav>

      <section aria-label={t('kpis.label')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.key}>
            <Eyebrow>{t(`kpis.${kpi.key}`)}</Eyebrow>
            <span
              className={`text-xl font-semibold ${kpi.tone ? toneClass(kpi.value) : ''}`}
              data-testid={`kpi-${kpi.key}`}
            >
              {kpi.tone ? withPlus(formatMoney(kpi.value), kpi.value) : formatMoney(kpi.value)}
            </span>
          </Card>
        ))}
        <Card>
          <Eyebrow>{t('kpis.savingsRate')}</Eyebrow>
          <span className="text-xl font-semibold" data-testid="kpi-savingsRate">
            {review.savingsRatePct === null
              ? t('kpis.noIncome')
              : formatPct(Number(review.savingsRatePct), { digits: 1 })}
          </span>
        </Card>
      </section>

      <MonthTimeline poolId={poolId} month={review.month} timeline={timeline} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <MonthCategories categories={review.categories} options={categories} />
        <MonthNoteCard
          key={review.month}
          poolId={poolId}
          month={review.month}
          note={note}
          members={members}
          canWrite={canWriteNotes}
          onSaved={setNote}
        />
      </div>

      <MonthNotable
        poolId={poolId}
        items={review.notable}
        members={members}
        canWrite={canWriteNotes}
      />
      <MonthOperations
        poolId={poolId}
        groups={review.operations}
        members={members}
        canWrite={canWriteNotes}
      />
    </div>
  );
}
