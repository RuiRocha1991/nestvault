'use client';

import { Button, Input, Modal, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { CategoryView } from '@webapp/lib/expenses-types';
import { budgetToText, MOVEMENT_KINDS, parseBudgetText } from '@webapp/lib/expenses-view';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';
import { useCategoryLabel } from './use-category-label';

export interface CategoryDialogProps {
  poolId: string;
  /** The category being edited; absent when adding one. */
  category?: CategoryView;
  onClose: () => void;
  onDone: () => void;
}

const DEFAULT_COLOR = '#8C8FB8';

/**
 * A pool's own category: name, kind, colour and budget. A global one (the catalogue belongs to the
 * app, ADR 0004): only this pool's budget, colour and visibility. The body carries those fields
 * only; the server decides who may write (`categories.write`).
 */
export function CategoryDialog({ poolId, category, onClose, onDone }: CategoryDialogProps) {
  const t = useTranslations('expenses.categories');
  const tk = useTranslations('expenses.kinds');
  const tc = useTranslations('expenses');
  const label = useCategoryLabel();
  const ids = { form: useId(), name: useId(), kind: useId(), color: useId(), budget: useId() };
  const global = category?.global ?? false;
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR);
  const [budget, setBudget] = useState(budgetToText(category?.monthlyBudget ?? null));
  const [hidden, setHidden] = useState(category?.hidden ?? false);
  const [errors, setErrors] = useState<{ name?: string; budget?: string }>({});
  const action = useMemberAction(onDone);

  const base = `/api/v1/pools/${encodeURIComponent(poolId)}/categories`;
  const taken = action.problem?.status === 409;

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const monthlyBudget = parseBudgetText(budget);
    const found: typeof errors = {};
    if (!global && name.trim() === '') found.name = t('nameRequired');
    if (monthlyBudget === undefined) found.budget = t('budgetInvalid');
    setErrors(found);
    if (found.name || monthlyBudget === undefined) return;

    void action.run(async () => {
      if (global && category) {
        return sendJson('PATCH', `${base}/${encodeURIComponent(category.id)}/settings`, {
          monthlyBudget,
          hidden,
          // The colour is the pool's override; only sent when it changed.
          ...(color !== category.color ? { colorOverride: color } : {}),
        });
      }
      const body = { name: name.trim(), kind, color };
      const saved = category
        ? await sendJson('PATCH', `${base}/${encodeURIComponent(category.id)}`, body)
        : await postJson(base, body);
      if (!saved.ok) return saved;
      const id = category?.id ?? ((await saved.clone().json()) as { id: string }).id;
      const unchanged = (category?.monthlyBudget ?? null) === monthlyBudget;
      if (unchanged) return saved;
      return sendJson('PATCH', `${base}/${encodeURIComponent(id)}/settings`, { monthlyBudget });
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={category ? (global ? t('settingsTitle') : t('editTitle')) : t('newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={action.busy}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} hiddenStatuses={[409]} />
      {global && category && (
        <div className="flex flex-col gap-1">
          <b>{label(category)}</b>
          <p className="m-0 text-sm text-fg-2">{t('settingsLead')}</p>
        </div>
      )}
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {!global && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-sm font-medium text-fg-2">
              {t('name')}
            </label>
            <Input
              id={ids.name}
              autoComplete="off"
              maxLength={60}
              value={name}
              aria-invalid={!!errors.name || taken}
              onChange={(event) => {
                setName(event.target.value);
                setErrors({});
                action.clearProblem();
              }}
            />
            {(!!errors.name || taken) && (
              <p role="alert" className="text-sm text-neg">
                {errors.name ?? t('nameTaken')}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-4">
          {!global && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.kind} className="text-sm font-medium text-fg-2">
                {t('kind')}
              </label>
              <Select
                id={ids.kind}
                value={kind}
                onChange={(event) => {
                  setKind(
                    MOVEMENT_KINDS.find((entry) => entry === event.target.value) ?? 'expense',
                  );
                }}
              >
                {MOVEMENT_KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {tk(entry)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.color} className="text-sm font-medium text-fg-2">
              {t('color')}
            </label>
            <Input
              id={ids.color}
              type="color"
              className="h-10 w-24 p-1"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.budget} className="text-sm font-medium text-fg-2">
            {t('budget')}
          </label>
          <Input
            id={ids.budget}
            inputMode="decimal"
            autoComplete="off"
            value={budget}
            aria-invalid={!!errors.budget}
            onChange={(event) => {
              setBudget(event.target.value);
              setErrors({});
            }}
          />
          <p className={errors.budget ? 'text-sm text-neg' : 'text-sm text-fg-3'}>
            {errors.budget ?? t('budgetHint')}
          </p>
        </div>
        {global && (
          <label className="inline-flex items-center gap-2 text-md text-fg-2">
            <input
              type="checkbox"
              checked={hidden}
              className="size-4 accent-[var(--accent)]"
              onChange={(event) => {
                setHidden(event.target.checked);
              }}
            />
            {t('hiddenLabel')}
          </label>
        )}
      </form>
    </Modal>
  );
}
