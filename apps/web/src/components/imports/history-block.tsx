'use client';

import { Card, EmptyState, Eyebrow, Table, Td, Th, formatDate } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { categoryMessageKey } from '@webapp/lib/category-name';
import type { ImportHistory } from '@webapp/lib/imports-types';

export interface HistoryBlockProps {
  history: ImportHistory;
  accountNames: ReadonlyMap<string, string>;
}

/** The last committed imports: date, file, account, rows and format (never the content). */
export function HistoryBlock({ history, accountNames }: HistoryBlockProps) {
  const t = useTranslations('imports');

  const parserName = (parserId: string) => {
    const key = categoryMessageKey(parserId);
    return t.has(`parsers.${key}`) ? t(`parsers.${key}`) : parserId;
  };

  return (
    <section aria-label={t('history.title')} className="flex flex-col gap-3">
      <Eyebrow>{t('history.title')}</Eyebrow>
      <Card>
        {history.items.length === 0 ? (
          <EmptyState title={t('history.empty')} />
        ) : (
          <Table aria-label={t('history.title')}>
            <thead>
              <tr>
                <Th>{t('history.date')}</Th>
                <Th>{t('history.file')}</Th>
                <Th>{t('history.account')}</Th>
                <Th numeric>{t('history.rows')}</Th>
                <Th numeric>{t('history.imported')}</Th>
                <Th>{t('history.parser')}</Th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.batchId}>
                  <Td>{formatDate(item.committedAt)}</Td>
                  <Td className="max-w-[260px] truncate">{item.fileName}</Td>
                  <Td>
                    {(item.accountId && accountNames.get(item.accountId)) ||
                      t('history.unknownAccount')}
                  </Td>
                  <Td numeric>{item.rowCount}</Td>
                  <Td numeric>{item.inserted ?? ''}</Td>
                  <Td>{parserName(item.parserId)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
