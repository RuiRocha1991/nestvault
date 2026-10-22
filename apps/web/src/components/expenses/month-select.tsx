'use client';

import { Select } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { monthLabel } from '@webapp/lib/expenses-view';

export interface MonthSelectProps {
  poolId: string;
  /** Selected `yyyy-mm`. */
  month: string;
  months: readonly string[];
}

/** The month selector of the Resumo; the month lives in the URL (`?tab=resumo&month=yyyy-mm`). */
export function MonthSelect({ poolId, month, months }: MonthSelectProps) {
  const t = useTranslations('expenses.summary');
  const router = useRouter();
  return (
    <Select
      compact
      aria-label={t('monthLabel')}
      value={month}
      className="min-w-[130px]"
      onChange={(event) => {
        router.replace(
          `/${poolId}/despesas?tab=resumo&month=${encodeURIComponent(event.target.value)}`,
          { scroll: false },
        );
      }}
    >
      {[...months].reverse().map((entry) => (
        <option key={entry} value={entry}>
          {monthLabel(entry)}
        </option>
      ))}
    </Select>
  );
}
