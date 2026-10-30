import { formatMoney, formatPct } from '@nestvault/ui';
import { ArrowLeftRight, Download, FileText, TrendingUp, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { camelKey, monthYearOf } from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

type Event = LoanBundle['events'][number];

const ICONS: Record<Event['kind'] | 'contract', LucideIcon> = {
  rate_review: TrendingUp,
  renegotiation: ArrowLeftRight,
  prepayment: Download,
  contract: FileText,
};

/** One entry of the timeline: month, title and what the event did (mockups 28 and 30). */
export function EventLine({ event, loan }: { event?: Event; loan?: LoanBundle['loan'] }) {
  const t = useTranslations('realEstate.events');
  const kind = event ? event.kind : 'contract';
  const Icon = ICONS[kind];
  const date = event?.date ?? loan?.startDate ?? '';
  const impact = event?.impact;
  const parts: string[] = [];

  if (event?.kind === 'rate_review') {
    if (impact) {
      parts.push(
        t('rateChange', {
          before: formatPct(impact.annualRateBefore, { digits: 2 }),
          after: formatPct(impact.annualRateAfter, { digits: 2 }),
        }),
      );
    } else if (event.annualRate) {
      parts.push(t('rate', { rate: formatPct(event.annualRate, { digits: 2 }) }));
    }
  }
  if (event?.kind === 'prepayment') {
    if (event.amount) parts.push(formatMoney(event.amount));
    if (event.effect) parts.push(t('effect', { effect: t(`effects.${camelKey(event.effect)}`) }));
  }
  if (event?.kind === 'renegotiation') {
    if (impact) parts.push(t('remaining', { count: impact.remainingAfter }));
    if (event.annualRate)
      parts.push(t('rate', { rate: formatPct(event.annualRate, { digits: 2 }) }));
  }
  if (impact && impact.paymentBefore !== impact.paymentAfter) {
    parts.push(
      t('paymentChange', {
        before: formatMoney(impact.paymentBefore),
        after: formatMoney(impact.paymentAfter),
      }),
    );
  } else if (impact && event.kind === 'renegotiation') {
    parts.push(t('payment', { payment: formatMoney(impact.paymentAfter) }));
  }
  if (!event && loan) {
    parts.push(
      t('contractLine', { principal: formatMoney(loan.principal), months: loan.termMonths }),
    );
  }

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        aria-hidden
        className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-panel-2 text-accent-2"
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-fg-3">{monthYearOf(date)}</span>
        <b className="text-md">{t(`kinds.${camelKey(kind)}`)}</b>
        <span className="text-sm text-fg-3">{parts.join(' · ')}</span>
      </div>
    </li>
  );
}
