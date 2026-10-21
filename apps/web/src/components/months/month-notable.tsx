'use client';

import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  formatDate,
  formatMoney,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { NoteIndicator } from '@webapp/components/notes/note-indicator';
import { NoteSheet } from '@webapp/components/notes/note-sheet';
import { useNoteRow } from '@webapp/components/notes/use-note-row';
import type { MemberOption, NotableTransaction } from '@webapp/lib/month-types';
import { editorNameOf } from '@webapp/lib/month-view';
import type { NoteState } from '@webapp/lib/note-view';
import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

/** Every transaction with a note, the largest expenses and the largest income of the month. */
export function MonthNotable({
  poolId,
  items,
  members,
  canWrite,
}: {
  poolId: string;
  items: readonly NotableTransaction[];
  members: readonly MemberOption[];
  canWrite: boolean;
}) {
  const t = useTranslations('months.notable');
  // Notes saved from the side panel, so the indicator changes before the page is refreshed.
  const [saved, setSaved] = useState<ReadonlyMap<string, NoteState>>(new Map());
  const [open, setOpen] = useState<NotableTransaction | null>(null);

  const stateOf = (item: NotableTransaction): NoteState =>
    saved.get(item.id) ?? {
      note: item.note,
      noteUpdatedBy: item.noteUpdatedBy,
      noteUpdatedAt: item.noteUpdatedAt,
    };

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} />
      {items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('date')}</Th>
              <Th>{t('description')}</Th>
              <Th>{t('account')}</Th>
              <Th>{t('why')}</Th>
              <Th numeric>{t('amount')}</Th>
              <Th>
                <span className="sr-only">{t('note')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <NotableRow
                key={item.id}
                item={item}
                note={stateOf(item).note}
                onOpen={() => {
                  setOpen(item);
                }}
              />
            ))}
          </tbody>
        </Table>
      )}
      {!!open && (
        <NoteSheet
          poolId={poolId}
          kind="transaction"
          id={open.id}
          note={stateOf(open)}
          editorName={editorNameOf(stateOf(open).noteUpdatedBy, members)}
          canWrite={canWrite}
          details={
            <p className="text-sm text-fg-2">
              {`${formatDate(open.date)} · ${open.description} · ${formatMoney(open.amount)}`}
            </p>
          }
          onClose={() => {
            setOpen(null);
          }}
          onSaved={(next) => {
            setSaved((current) => new Map(current).set(open.id, next));
          }}
        />
      )}
    </Card>
  );
}

function NotableRow({
  item,
  note,
  onOpen,
}: {
  item: NotableTransaction;
  note: string | null;
  onOpen: () => void;
}) {
  const t = useTranslations('months.notable');
  const tn = useTranslations('notes');
  const rowProps = useNoteRow(onOpen);
  return (
    <tr {...rowProps} className="hover:bg-panel-2 focus-visible:outline focus-visible:outline-2">
      <Td className="whitespace-nowrap">{formatDate(item.date)}</Td>
      <Td>{item.description}</Td>
      <Td className="text-fg-2">{item.accountName}</Td>
      <Td>
        <span className="flex flex-wrap gap-1">
          {item.reasons.map((reason) => (
            <Chip key={reason} tone={reason === 'top-income' ? 'pos' : 'default'}>
              {t(`reasons.${reason}`)}
            </Chip>
          ))}
        </span>
      </Td>
      <Td numeric className={toneClass(item.amount)}>
        {withPlus(formatMoney(item.amount), item.amount)}
      </Td>
      <Td>
        <NoteIndicator note={note} label={tn('view')} onOpen={onOpen} />
      </Td>
    </tr>
  );
}
