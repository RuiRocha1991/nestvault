'use client';

import { Button, Input, Select } from '@nestvault/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog, textareaClass } from '@webapp/components/portfolios/form-dialog';
import type { TabContext } from '@webapp/components/portfolios/types';
import { poolApi, rowsToTargets, targetsToRows, type TargetRow } from '@webapp/lib/portfolio-forms';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
const DEFAULT_COLOR = '#9d6bff';

/** New or changed portfolio: name, colour, currency, note and the target allocation. */
export function PortfolioDialog({
  ctx,
  portfolioId,
  onClose,
  onDone,
  onDeleted,
}: {
  ctx: TabContext;
  portfolioId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
  /** After deleting the portfolio the screen leaves its URL. */
  onDeleted: () => void;
}) {
  const t = useTranslations('portfolios.portfolioDialog');
  const ids = { name: useId(), color: useId(), currency: useId(), note: useId(), move: useId() };
  const existing = portfolioId ? ctx.portfolios.find((p) => p.id === portfolioId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? DEFAULT_COLOR);
  const [currency, setCurrency] = useState(existing?.currency ?? 'EUR');
  const [note, setNote] = useState(existing?.note ?? '');
  const [rows, setRows] = useState<TargetRow[]>(targetsToRows(existing?.targets ?? {}));
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const save = useMemberAction(onDone);
  const remove = useMemberAction(onDeleted);
  const others = ctx.portfolios.filter((p) => p.id !== existing?.id);
  const action = deleting ? remove : save;
  const duplicate = action.problem?.status === 409 ? t('duplicate') : null;
  const hasOps = (existing?.opsCount ?? 0) + (existing?.plansCount ?? 0) > 0;

  function submit() {
    if (deleting && existing) {
      const query = hasOps
        ? moveTo
          ? `?moveTo=${encodeURIComponent(moveTo)}`
          : '?deleteOps=true'
        : '';
      void remove.run(() =>
        sendJson('DELETE', `${poolApi(ctx.poolId, 'portfolios', existing.id)}${query}`),
      );
      return;
    }
    if (name.trim() === '') {
      setMissing(true);
      return;
    }
    const body = {
      name: name.trim(),
      color,
      currency,
      note: note.trim() === '' ? null : note.trim(),
      targets: rowsToTargets(rows),
    };
    void save.run(() =>
      existing
        ? sendJson('PATCH', poolApi(ctx.poolId, 'portfolios', existing.id), body)
        : postJson(poolApi(ctx.poolId, 'portfolios'), body),
    );
  }

  if (deleting && existing) {
    return (
      <FormDialog
        title={t('deleteTitle', { name: existing.name })}
        submitLabel={t('deleteConfirm')}
        destructive
        action={action}
        onClose={onClose}
        onSubmit={submit}
      >
        <p className="text-md text-fg-2">
          {hasOps ? t('deleteWithOps', { count: existing.opsCount }) : t('deleteEmpty')}
        </p>
        {hasOps && (
          <Field id={ids.move} label={t('whatToDo')}>
            <Select
              id={ids.move}
              value={moveTo}
              onChange={(event) => {
                setMoveTo(event.target.value);
              }}
            >
              <option value="">{t('deleteEverything')}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('moveTo', { name: p.name })}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </FormDialog>
    );
  }

  return (
    <FormDialog
      wide
      title={existing ? t('editTitle') : t('title')}
      submitLabel={existing ? t('save') : t('create')}
      action={action}
      fieldProblem={duplicate}
      onClose={onClose}
      onSubmit={submit}
      footerStart={
        !!existing && (
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setDeleting(true);
            }}
          >
            <Trash2 aria-hidden />
            {t('delete')}
          </Button>
        )
      }
    >
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 one:grid-cols-1">
        <Field
          id={ids.name}
          label={t('name')}
          error={missing && name.trim() === '' ? t('required') : undefined}
        >
          <Input
            id={ids.name}
            autoComplete="off"
            maxLength={60}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMissing(false);
              save.clearProblem();
            }}
          />
        </Field>
        <Field id={ids.color} label={t('color')}>
          <Input
            id={ids.color}
            type="color"
            className="h-[34px] w-16 p-1"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
            }}
          />
        </Field>
        <Field id={ids.currency} label={t('currency')}>
          <Select
            id={ids.currency}
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
            }}
          >
            {CURRENCIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id={ids.note} label={t('note')}>
        <textarea
          id={ids.note}
          rows={2}
          maxLength={2000}
          className={textareaClass}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Field>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-fg-2">{t('targets')}</legend>
        <p className="text-sm text-fg-3">{t('targetsHint')}</p>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_90px_auto] items-center gap-2">
            <Input
              aria-label={t('targetLabel')}
              placeholder={t('targetLabel')}
              maxLength={40}
              value={row.label}
              onChange={(event) => {
                setRows((current) =>
                  current.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)),
                );
              }}
            />
            <Input
              aria-label={t('targetPercent')}
              inputMode="decimal"
              value={row.percent}
              onChange={(event) => {
                setRows((current) =>
                  current.map((r, i) => (i === index ? { ...r, percent: event.target.value } : r)),
                );
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="danger"
              icon
              aria-label={t('removeTarget')}
              onClick={() => {
                setRows((current) => current.filter((_, i) => i !== index));
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          className="self-start"
          onClick={() => {
            setRows((current) => [...current, { label: '', percent: '' }]);
          }}
        >
          <Plus aria-hidden />
          {t('addTarget')}
        </Button>
      </fieldset>
    </FormDialog>
  );
}
