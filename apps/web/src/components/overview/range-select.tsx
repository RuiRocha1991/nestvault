'use client';

import { Select } from '@nestvault/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { RANGES, DEFAULT_RANGE } from '@webapp/lib/overview-view';

/** The period of the evolution chart, kept in the URL (`?periodo=`) so a reload keeps it. */
export function RangeSelect({ value }: { value: string }) {
  const t = useTranslations('overview.evolution');
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select
      aria-label={t('period')}
      value={value}
      compact
      className="min-w-[104px]"
      onChange={(event) => {
        const next = event.target.value;
        router.replace(next === DEFAULT_RANGE ? pathname : `${pathname}?periodo=${next}`, {
          scroll: false,
        });
      }}
    >
      {RANGES.map((range) => (
        <option key={range} value={range}>
          {t(range === 'all' ? 'all' : `months${range}`)}
        </option>
      ))}
    </Select>
  );
}
