'use client';

import { Button, Modal, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { CategoryView } from '@webapp/lib/expenses-types';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';
import { useCategoryLabel } from './use-category-label';

export interface DeleteCategoryDialogProps {
  poolId: string;
  category: CategoryView;
  /** How many movements use it: while any do, they need somewhere to go. */
  uses: number;
  /** The categories the movements can move to (never the one being deleted). */
  others: readonly CategoryView[];
  onClose: () => void;
  onDone: () => void;
}

/** Deleting one of the pool's own categories; its movements move to a category of the user's choice. */
export function DeleteCategoryDialog({
  poolId,
  category,
  uses,
  others,
  onClose,
  onDone,
}: DeleteCategoryDialogProps) {
  const t = useTranslations('expenses.categories');
  const tc = useTranslations('expenses');
  const label = useCategoryLabel();
  const selectId = useId();
  const [replacement, setReplacement] = useState('');
  const [missing, setMissing] = useState(false);
  const action = useMemberAction(onDone);

  function confirm() {
    if (action.busy) return;
    if (uses > 0 && replacement === '') {
      setMissing(true);
      return;
    }
    const query = replacement ? `?replacement=${encodeURIComponent(replacement)}` : '';
    void action.run(() =>
      sendJson(
        'DELETE',
        `/api/v1/pools/${encodeURIComponent(poolId)}/categories/${encodeURIComponent(category.id)}${query}`,
      ),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('deleteTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" type="button" disabled={action.busy} onClick={confirm}>
            {t('deleteConfirm')}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} />
      <div className="flex flex-col gap-1">
        <b>{label(category)}</b>
        <p className="m-0 text-fg-2">
          {uses > 0 ? t('deleteText', { count: uses }) : t('deleteTextEmpty')}
        </p>
      </div>
      {uses > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium text-fg-2">
            {t('replacement')}
          </label>
          <Select
            id={selectId}
            value={replacement}
            aria-invalid={missing}
            onChange={(event) => {
              setReplacement(event.target.value);
              setMissing(false);
            }}
          >
            <option value="" />
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {label(other)}
              </option>
            ))}
          </Select>
          {missing && (
            <p role="alert" className="text-sm text-neg">
              {t('replacementRequired')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
