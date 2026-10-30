'use client';

import { Input, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog } from '@webapp/components/portfolios/form-dialog';
import {
  accountKey,
  emptyGoalForm,
  fieldsOf,
  GOAL_COLORS,
  GOAL_MODES,
  GOAL_TYPES,
  goalFormBody,
  goalToForm,
  isGoalFormComplete,
  type GoalForm,
  type GoalType,
  type GoalView,
} from '@webapp/lib/goals-view';
import { poolApi } from '@webapp/lib/portfolio-forms';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

export interface GoalScopeOptions {
  portfolios: readonly { id: string; name: string }[];
  accounts: readonly {
    id: string;
    name: string;
    subAccounts: readonly { id: string; name: string }[];
  }[];
}

/** Creates or edits a goal: type, target, deadline mode, projection inputs and what it counts. */
export function GoalDialog({
  poolId,
  goal,
  scope,
  defaultMonthly,
  defaultDeadline,
  color,
  onClose,
  onDone,
}: {
  poolId: string;
  goal?: GoalView | undefined;
  scope: GoalScopeOptions;
  /** The sum of the active regular plans, the monthly contribution of a new goal. */
  defaultMonthly: string;
  /** Ten years from today, the deadline of a new goal. */
  defaultDeadline: string;
  /** The colour a new goal starts with. */
  color: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('goals.dialog');
  const ids = {
    name: useId(),
    type: useId(),
    target: useId(),
    mode: useId(),
    deadline: useId(),
    color: useId(),
    monthly: useId(),
    rate: useId(),
    yield: useId(),
    savings: useId(),
  };
  const [form, setForm] = useState<GoalForm>(() =>
    goal
      ? goalToForm(goal, defaultDeadline)
      : emptyGoalForm({ deadline: defaultDeadline, color, monthly: defaultMonthly }),
  );
  const [missing, setMissing] = useState(false);
  const action = useMemberAction(onDone);
  const show = fieldsOf(form.type, form.mode);
  const set = <K extends keyof GoalForm>(key: K, value: GoalForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const toggle = (key: 'portfolioIds' | 'accounts', value: string) => {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  };

  function submit() {
    if (!isGoalFormComplete(form)) {
      setMissing(true);
      return;
    }
    const body = goalFormBody(form);
    void action.run(() =>
      goal
        ? sendJson('PATCH', poolApi(poolId, 'goals', goal.id), body)
        : postJson(poolApi(poolId, 'goals'), body),
    );
  }

  return (
    <FormDialog
      wide
      title={goal ? t('editTitle') : t('newTitle')}
      submitLabel={goal ? t('save') : t('create')}
      action={action}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field
        id={ids.name}
        label={t('name')}
        error={missing && form.name.trim() === '' ? t('required') : undefined}
      >
        <Input
          id={ids.name}
          value={form.name}
          maxLength={60}
          placeholder={t('namePlaceholder')}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id={ids.type} label={t('type')}>
          <Select
            id={ids.type}
            value={form.type}
            onChange={(event) => {
              set('type', event.target.value as GoalType);
            }}
          >
            {GOAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`typeOptions.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={ids.target}
          label={t('target')}
          error={missing && !isGoalFormComplete(form) ? t('required') : undefined}
        >
          <Input
            id={ids.target}
            inputMode="decimal"
            autoComplete="off"
            value={form.target}
            onChange={(event) => {
              set('target', event.target.value);
            }}
          />
          <span className="text-xs text-fg-3">{t(`targetHint.${form.type}`)}</span>
        </Field>
        {show.mode && (
          <Field id={ids.mode} label={t('mode')}>
            <Select
              id={ids.mode}
              value={form.mode}
              onChange={(event) => {
                set('mode', event.target.value as GoalForm['mode']);
              }}
            >
              {GOAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`modes.${mode}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {show.deadline && (
          <Field
            id={ids.deadline}
            label={t('deadline')}
            error={missing && form.deadline === '' ? t('deadlineRequired') : undefined}
          >
            <Input
              id={ids.deadline}
              type="date"
              value={form.deadline}
              onChange={(event) => {
                set('deadline', event.target.value);
              }}
            />
          </Field>
        )}
        <Field id={ids.color} label={t('color')}>
          <div role="group" aria-label={t('color')} className="flex flex-wrap gap-2 pt-1">
            {GOAL_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={form.color === value}
                aria-label={value}
                onClick={() => {
                  set('color', value);
                }}
                className="size-6 rounded-full border-2 border-transparent aria-pressed:border-fg"
                style={{ background: value }}
              />
            ))}
          </div>
        </Field>
        {show.monthly && (
          <Field id={ids.monthly} label={t('monthly')}>
            <Input
              id={ids.monthly}
              inputMode="decimal"
              autoComplete="off"
              value={form.monthly}
              onChange={(event) => {
                set('monthly', event.target.value);
              }}
            />
            <span className="text-xs text-fg-3">{t('monthlyHint')}</span>
          </Field>
        )}
        {show.rate && (
          <Field id={ids.rate} label={t('rate')}>
            <Input
              id={ids.rate}
              inputMode="decimal"
              autoComplete="off"
              value={form.rate}
              onChange={(event) => {
                set('rate', event.target.value);
              }}
            />
            <span className="text-xs text-fg-3">{t('rateHint')}</span>
          </Field>
        )}
        {show.yield && (
          <Field id={ids.yield} label={t('yield')}>
            <Input
              id={ids.yield}
              inputMode="decimal"
              autoComplete="off"
              placeholder={t('yieldPlaceholder')}
              value={form.yield}
              onChange={(event) => {
                set('yield', event.target.value);
              }}
            />
          </Field>
        )}
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-fg-2">{t('portfolios')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {scope.portfolios.map((portfolio) => (
            <label key={portfolio.id} className="flex items-center gap-2 text-md">
              <input
                type="checkbox"
                checked={form.portfolioIds.includes(portfolio.id)}
                onChange={() => {
                  toggle('portfolioIds', portfolio.id);
                }}
              />
              {portfolio.name}
            </label>
          ))}
        </div>
        <span className="text-xs text-fg-3">{t('portfoliosHint')}</span>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-fg-2">{t('accounts')}</legend>
        <div className="flex max-h-56 flex-col gap-1.5 overflow-auto">
          {scope.accounts.length === 0 && (
            <span className="text-sm text-fg-3">{t('noAccounts')}</span>
          )}
          {scope.accounts.map((account) => (
            <div key={account.id} className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-md">
                <input
                  type="checkbox"
                  checked={form.accounts.includes(accountKey(account.id))}
                  onChange={() => {
                    toggle('accounts', accountKey(account.id));
                  }}
                />
                {account.name}
              </label>
              {account.subAccounts.map((sub) => (
                <label key={sub.id} className="flex items-center gap-2 pl-6 text-md">
                  <input
                    type="checkbox"
                    checked={form.accounts.includes(accountKey(account.id, sub.id))}
                    onChange={() => {
                      toggle('accounts', accountKey(account.id, sub.id));
                    }}
                  />
                  {`↳ ${sub.name}`}
                </label>
              ))}
            </div>
          ))}
        </div>
        <span className="text-xs text-fg-3">{t('accountsHint')}</span>
      </fieldset>

      {show.savings && (
        <label htmlFor={ids.savings} className="flex items-center gap-2 text-md">
          <input
            id={ids.savings}
            type="checkbox"
            checked={form.includeSavings}
            onChange={(event) => {
              set('includeSavings', event.target.checked);
            }}
          />
          {t('includeSavings')}
        </label>
      )}
    </FormDialog>
  );
}
