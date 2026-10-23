'use client';

import { Chip, Table, Td, Th, formatDate, formatMoney, formatNumber } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { useCategoryLabel } from '@webapp/components/expenses/use-category-label';
import type { CategoryView } from '@webapp/lib/expenses-types';
import type { ImportPreview } from '@webapp/lib/imports-types';

/** Rows shown in the table; the commit writes every row of the file. */
export const TABLE_ROWS = 50;

type Row = ImportPreview['rows'][number];

export interface PreviewTableProps {
  preview: ImportPreview;
  categories: readonly CategoryView[];
}

const MONEY_TONE = (amount: string) => (amount.startsWith('-') ? 'text-neg' : 'text-pos');

/** The first lines of the file with the category the rules predict and whether each is new. */
export function PreviewTable({ preview, categories }: PreviewTableProps) {
  const t = useTranslations('imports');
  const label = useCategoryLabel();
  const byId = new Map(categories.map((category) => [category.id, category]));
  const shown = preview.rows.slice(0, TABLE_ROWS);

  function status(row: Row): { text: string; tone: 'default' | 'pos' | 'warn' | 'accent' } {
    if (row.kind === 'bank' ? !row.valid : !row.supported) {
      return { text: t('status.skipped'), tone: 'warn' };
    }
    if (row.duplicate === true) return { text: t('status.duplicate'), tone: 'default' };
    if (row.duplicate === null) return { text: t('status.unknown'), tone: 'default' };
    if (row.kind === 'bank' && (row.transfer || row.transferPair)) {
      return { text: t('status.transfer'), tone: 'accent' };
    }
    return { text: t('status.new'), tone: 'pos' };
  }

  const operation = (type: string) => (t.has(`operation.${type}`) ? t(`operation.${type}`) : type);

  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={t('table.label')}>
        <thead>
          <tr>
            <Th>{t('table.date')}</Th>
            {preview.kind === 'bank' ? (
              <>
                <Th>{t('table.description')}</Th>
                <Th numeric>{t('table.amount')}</Th>
                <Th>{t('table.category')}</Th>
              </>
            ) : (
              <>
                <Th>{t('table.type')}</Th>
                <Th>{t('table.asset')}</Th>
                <Th numeric>{t('table.quantity')}</Th>
                <Th numeric>{t('table.price')}</Th>
                <Th numeric>{t('table.amount')}</Th>
                <Th>{t('table.holder')}</Th>
              </>
            )}
            <Th>{t('table.status')}</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const state = status(row);
            const category =
              row.kind === 'bank' && row.categoryId ? byId.get(row.categoryId) : undefined;
            return (
              <tr key={row.index}>
                <Td>{formatDate(row.date)}</Td>
                {row.kind === 'bank' ? (
                  <>
                    <Td className="max-w-[320px] truncate">{row.description}</Td>
                    <Td numeric className={MONEY_TONE(row.amount)}>
                      {formatMoney(row.amount)}
                    </Td>
                    <Td className="text-fg-2">
                      {category ? label(category) : t('table.uncategorized')}
                    </Td>
                  </>
                ) : (
                  <>
                    <Td>{operation(row.type)}</Td>
                    <Td>{row.symbol ?? t('status.unknown')}</Td>
                    <Td numeric>{row.quantity ? formatNumber(row.quantity, 4) : ''}</Td>
                    <Td numeric>{row.price ? formatNumber(row.price, 4) : ''}</Td>
                    <Td numeric>{formatMoney(row.amount, row.currency)}</Td>
                    <Td>{row.holder ?? ''}</Td>
                  </>
                )}
                <Td>
                  <Chip tone={state.tone}>{state.text}</Chip>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {preview.rows.length > shown.length && (
        <p className="m-0 text-sm text-fg-3">
          {t('table.shown', { shown: shown.length, total: preview.summary.total })}
        </p>
      )}
    </div>
  );
}
