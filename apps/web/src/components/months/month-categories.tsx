'use client';

import {
  Card,
  CardHeader,
  Donut,
  EmptyState,
  formatMoney,
  formatPct,
  SERIES_COLORS,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { categoryMessageKey } from '@webapp/lib/category-name';
import type { CategoryOption, MonthCategory } from '@webapp/lib/month-types';
import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

/** Expenses of the month by category, with the budget and the difference to the last three months. */
export function MonthCategories({
  categories,
  options,
}: {
  categories: readonly MonthCategory[];
  options: readonly CategoryOption[];
}) {
  const t = useTranslations('months.categories');
  const tc = useTranslations('categories');
  const nameOf = (id: string | null): string => {
    if (id === null) return t('uncategorized');
    const option = options.find((o) => o.id === id);
    if (!option) return t('uncategorized');
    return option.systemKey ? tc(categoryMessageKey(option.systemKey)) : (option.name ?? '');
  };
  const colorOf = (id: string | null, index: number): string =>
    options.find((o) => o.id === id)?.color ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? '';

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} />
      {categories.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <>
          <Donut
            label={t('chart')}
            centerLabel={t('total')}
            segments={categories.map((c, i) => ({
              name: nameOf(c.categoryId),
              value: Number(c.value),
              color: colorOf(c.categoryId, i),
            }))}
          />
          <Table>
            <thead>
              <tr>
                <Th>{t('category')}</Th>
                <Th numeric>{t('spent')}</Th>
                <Th numeric>{t('budget')}</Th>
                <Th numeric>{t('average')}</Th>
                <Th numeric>{t('difference')}</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.categoryId ?? 'none'}>
                  <Td>{nameOf(c.categoryId)}</Td>
                  <Td numeric>{formatMoney(c.value)}</Td>
                  <Td numeric>
                    {c.budget === null ? (
                      '—'
                    ) : (
                      <span title={formatPct(Number(c.budgetUsedPct ?? 0), { digits: 0 })}>
                        {formatMoney(c.budget)}
                      </span>
                    )}
                  </Td>
                  <Td numeric>{formatMoney(c.previousAverage)}</Td>
                  {/* More spent than usual is bad news, so the colour is the opposite of a gain. */}
                  <Td numeric className={toneClass(String(-Number(c.difference)))}>
                    {withPlus(formatMoney(c.difference), c.difference)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}
