'use client';

import { cn, formatDate, formatMoney, Select, Td } from '@nestvault/ui';
import { ArrowLeftRight, MessageSquarePlus, Trash2, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { NoteIndicator } from '@webapp/components/notes/note-indicator';
import { useNoteRow } from '@webapp/components/notes/use-note-row';
import type { CategoryView, TransactionView } from '@webapp/lib/expenses-types';

import { useCategoryLabel } from './use-category-label';

export interface MovementRowProps {
  row: TransactionView;
  /** "Conta à ordem · Ana": the account and the people who own it. */
  accountLabel: string;
  currency: string;
  /** The categories to pick from, in the order of the select. */
  categories: readonly CategoryView[];
  /** `transactions.write`; the buttons are cosmetic, the service decides. */
  canWrite: boolean;
  /** `categories.write`: only these members can turn a movement into a rule. */
  canRules: boolean;
  onCategory: (categoryId: string) => void;
  onToggleTransfer: () => void;
  onNote: () => void;
  onRule: () => void;
  onDelete: () => void;
}

const GROUPS = ['expense', 'income', 'refund', 'transfer', 'invest'] as const;
const GROUP_KEY = {
  expense: 'groupExpense',
  income: 'groupIncome',
  refund: 'groupRefund',
  transfer: 'groupTransfer',
  invest: 'groupInvest',
} as const;

/** One movement of the table: inline category, transfer toggle, note and the other row actions. */
export function MovementRow({
  row,
  accountLabel,
  currency,
  categories,
  canWrite,
  canRules,
  onCategory,
  onToggleTransfer,
  onNote,
  onRule,
  onDelete,
}: MovementRowProps) {
  const t = useTranslations('expenses.movements');
  const tg = useTranslations('expenses.categories');
  const noteRow = useNoteRow(onNote);
  const label = useCategoryLabel();
  const dim = row.transfer;
  const positive = !row.amount.startsWith('-');
  const options = categories.filter(
    (category) => !category.hidden || category.id === row.categoryId,
  );

  return (
    <tr
      {...noteRow}
      data-testid="movement-row"
      className={cn('focus-visible:bg-panel-2 hover:bg-panel-2', dim && 'text-fg-3')}
    >
      <Td className="whitespace-nowrap tabular-nums">{formatDate(row.date)}</Td>
      <Td className="min-w-[200px]">
        <div className="flex items-center gap-2">
          <span className={cn('min-w-0 break-words', dim && 'line-through')}>
            {row.description}
          </span>
          <NoteIndicator
            note={row.note}
            label={t('noteOf', { description: row.description })}
            onOpen={onNote}
          />
        </div>
        {row.transfer && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-2">
            <ArrowLeftRight aria-hidden className="size-3" />
            {t('internal')}
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-fg-3 one:hidden">{accountLabel}</Td>
      <Td className="min-w-[170px]">
        <Select
          aria-label={t('categoryOf', { description: row.description })}
          value={row.categoryId ?? ''}
          disabled={!canWrite}
          className={cn('h-[30px]', dim && 'text-fg-3')}
          onChange={(event) => {
            if (event.target.value && event.target.value !== row.categoryId) {
              onCategory(event.target.value);
            }
          }}
        >
          {row.categoryId === null && <option value="">{t('noCategory')}</option>}
          {GROUPS.map((kind) => {
            const group = options.filter((category) => category.kind === kind);
            return (
              group.length > 0 && (
                <optgroup key={kind} label={tg(GROUP_KEY[kind])}>
                  {group.map((category) => (
                    <option key={category.id} value={category.id}>
                      {label(category)}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </Select>
      </Td>
      <Td
        numeric
        className={cn('font-semibold', positive && !dim && 'text-pos', dim && 'font-normal')}
      >
        {`${positive ? '+' : ''}${formatMoney(row.amount, currency)}`}
      </Td>
      <Td className="whitespace-nowrap text-right">
        <span className="inline-flex items-center gap-0.5">
          {canWrite && (
            <RowButton
              label={row.transfer ? t('unmarkTransfer') : t('markTransfer')}
              pressed={row.transfer}
              onClick={onToggleTransfer}
            >
              <ArrowLeftRight aria-hidden />
            </RowButton>
          )}
          {row.note === null && (
            <RowButton label={t('addNote')} onClick={onNote}>
              <MessageSquarePlus aria-hidden />
            </RowButton>
          )}
          {canRules && row.suggestedKeyword !== '' && (
            <RowButton label={t('createRule')} onClick={onRule}>
              <Wand2 aria-hidden />
            </RowButton>
          )}
          {canWrite && (
            <RowButton label={t('deleteMovement')} danger onClick={onDelete}>
              <Trash2 aria-hidden />
            </RowButton>
          )}
        </span>
      </Td>
    </tr>
  );
}

function RowButton({
  label,
  onClick,
  children,
  pressed,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-sm hover:bg-inset [&_svg]:size-4',
        danger ? 'text-neg' : 'text-fg-2 hover:text-fg',
        pressed && 'text-accent-2',
      )}
    >
      {children}
    </button>
  );
}

export const movementDetails = (row: TransactionView, currency: string) => ({
  date: formatDate(row.date),
  amount: formatMoney(row.amount, currency),
});
