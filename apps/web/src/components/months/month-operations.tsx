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
import type { MemberOption, MonthOperation, MonthOperationGroup } from '@webapp/lib/month-types';
import { editorNameOf } from '@webapp/lib/month-view';
import type { NoteState } from '@webapp/lib/note-view';
import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

const TONE = { buy: 'accent', sell: 'warn', div: 'pos' } as const;

/** The investment operations of the month, one table per portfolio. */
export function MonthOperations({
  poolId,
  groups,
  members,
  canWrite,
}: {
  poolId: string;
  groups: readonly MonthOperationGroup[];
  members: readonly MemberOption[];
  canWrite: boolean;
}) {
  const t = useTranslations('months.operations');
  const tn = useTranslations('notes');
  const [saved, setSaved] = useState<ReadonlyMap<string, NoteState>>(new Map());
  const [open, setOpen] = useState<MonthOperation | null>(null);

  const stateOf = (op: MonthOperation): NoteState =>
    saved.get(op.id) ?? {
      note: op.note,
      noteUpdatedBy: op.noteUpdatedBy,
      noteUpdatedAt: op.noteUpdatedAt,
    };

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} />
      {groups.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        groups.map((group) => (
          <div key={group.portfolioId ?? 'none'} className="flex flex-col gap-2">
            <h3 className="text-md font-semibold">{group.portfolioName ?? t('noPortfolio')}</h3>
            <Table>
              <thead>
                <tr>
                  <Th>{t('date')}</Th>
                  <Th>{t('asset')}</Th>
                  <Th>{t('kind')}</Th>
                  <Th numeric>{t('qty')}</Th>
                  <Th numeric>{t('cash')}</Th>
                  <Th>
                    <span className="sr-only">{t('note')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {group.operations.map((op) => (
                  <OperationRow
                    key={op.id}
                    op={op}
                    note={stateOf(op).note}
                    onOpen={() => {
                      setOpen(op);
                    }}
                    noteLabel={tn('view')}
                  />
                ))}
              </tbody>
            </Table>
          </div>
        ))
      )}
      {!!open && (
        <NoteSheet
          poolId={poolId}
          kind="operation"
          id={open.id}
          note={stateOf(open)}
          editorName={editorNameOf(stateOf(open).noteUpdatedBy, members)}
          canWrite={canWrite}
          details={
            <p className="text-sm text-fg-2">{`${formatDate(open.date)} · ${open.ticker}`}</p>
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

function OperationRow({
  op,
  note,
  noteLabel,
  onOpen,
}: {
  op: MonthOperation;
  note: string | null;
  noteLabel: string;
  onOpen: () => void;
}) {
  const t = useTranslations('months.operations');
  const rowProps = useNoteRow(onOpen);
  return (
    <tr {...rowProps} className="hover:bg-panel-2 focus-visible:outline focus-visible:outline-2">
      <Td className="whitespace-nowrap">{formatDate(op.date)}</Td>
      <Td>{op.ticker}</Td>
      <Td>
        <Chip tone={TONE[op.type]}>{t(`kinds.${op.type}`)}</Chip>
      </Td>
      <Td numeric>
        {op.qty === null
          ? ''
          : Number(op.qty).toLocaleString('pt-PT', { maximumFractionDigits: 4 })}
      </Td>
      <Td numeric className={toneClass(op.cashEffect)}>
        {withPlus(formatMoney(op.cashEffect), op.cashEffect)}
      </Td>
      <Td>
        <NoteIndicator note={note} label={noteLabel} onOpen={onOpen} />
      </Td>
    </tr>
  );
}
