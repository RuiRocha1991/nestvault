'use client';

import { Input, Segmented, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog, textareaClass } from '@webapp/components/portfolios/form-dialog';
import type { TabContext } from '@webapp/components/portfolios/types';
import {
  emptyOpForm,
  missingOpFields,
  opBody,
  opToForm,
  poolApi,
  type OpForm,
  type OpKind,
} from '@webapp/lib/portfolio-forms';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

const KINDS: readonly OpKind[] = ['buy', 'sell', 'dividend'];

/** Modal 16: a new or changed buy, sell or dividend. */
export function OpDialog({
  ctx,
  today,
  opId,
  assetId,
  type,
  onClose,
  onDone,
}: {
  ctx: TabContext;
  /** Today in Lisbon, the default date. */
  today: string;
  opId?: string | undefined;
  assetId?: string | undefined;
  type?: OpKind | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.opDialog');
  const ids = {
    portfolio: useId(),
    asset: useId(),
    date: useId(),
    account: useId(),
    sub: useId(),
    qty: useId(),
    price: useId(),
    fee: useId(),
    amount: useId(),
    gross: useId(),
    tax: useId(),
    note: useId(),
    fromCash: useId(),
  };
  const existing = opId ? ctx.data.ops.find((op) => op.id === opId) : undefined;
  const [form, setForm] = useState<OpForm>(() =>
    existing
      ? opToForm(existing)
      : emptyOpForm({
          date: today,
          portfolioId: ctx.portfolioId ?? ctx.portfolios[0]?.id ?? '',
          ...(assetId ? { assetId } : {}),
          ...(type ? { type } : {}),
        }),
  );
  const [missing, setMissing] = useState<readonly (keyof OpForm)[]>([]);
  const action = useMemberAction(onDone);

  const set = (patch: Partial<OpForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setMissing([]);
    action.clearProblem();
  };
  const error = (field: keyof OpForm) => (missing.includes(field) ? t('required') : undefined);
  const brokerage = ctx.accounts.filter((a) => a.type === 'brokerage' || a.trackCash);
  const subAccounts = ctx.accounts.find((a) => a.id === form.accountId)?.subAccounts ?? [];
  const isDividend = form.type === 'dividend';
  const currency = ctx.assetsById.get(form.assetId)?.currency;

  function submit() {
    const absent = missingOpFields(form);
    setMissing(absent);
    if (absent.length > 0) return;
    const body = opBody(form);
    void action.run(() =>
      existing
        ? sendJson('PATCH', poolApi(ctx.poolId, 'ops', existing.id), body)
        : postJson(poolApi(ctx.poolId, 'ops'), body),
    );
  }

  return (
    <FormDialog
      wide
      title={existing ? t('editTitle') : t('title')}
      submitLabel={existing ? t('save') : t('create')}
      action={action}
      onClose={onClose}
      onSubmit={submit}
    >
      <Segmented
        label={t('type')}
        value={form.type}
        onChange={(next) => {
          set({ type: next });
        }}
        options={KINDS.map((value) => ({ value, label: t(`types.${value}`) }))}
      />
      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <Field id={ids.portfolio} label={t('portfolio')} error={error('portfolioId')}>
          <Select
            id={ids.portfolio}
            value={form.portfolioId}
            onChange={(event) => {
              set({ portfolioId: event.target.value });
            }}
          >
            <option value="">{t('choose')}</option>
            {ctx.portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.asset} label={t('asset')} error={error('assetId')}>
          <Select
            id={ids.asset}
            value={form.assetId}
            onChange={(event) => {
              set({ assetId: event.target.value });
            }}
          >
            <option value="">{t('choose')}</option>
            {ctx.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.ticker} · ${a.name}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.date} label={t('date')} error={error('date')}>
          <Input
            id={ids.date}
            type="date"
            value={form.date}
            onChange={(event) => {
              set({ date: event.target.value });
            }}
          />
        </Field>
        <Field id={ids.account} label={t('account')}>
          <Select
            id={ids.account}
            value={form.accountId}
            onChange={(event) => {
              set({ accountId: event.target.value, subAccountId: '' });
            }}
          >
            <option value="">{t('noAccount')}</option>
            {brokerage.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {subAccounts.length > 0 && (
          <Field id={ids.sub} label={t('subAccount')}>
            <Select
              id={ids.sub}
              value={form.subAccountId}
              onChange={(event) => {
                set({ subAccountId: event.target.value });
              }}
            >
              <option value="">{t('noSubAccount')}</option>
              {subAccounts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!isDividend && (
          <>
            <Field id={ids.qty} label={t('qty')} error={error('qty')}>
              <Input
                id={ids.qty}
                inputMode="decimal"
                autoComplete="off"
                value={form.qty}
                onChange={(event) => {
                  set({ qty: event.target.value });
                }}
              />
            </Field>
            <Field
              id={ids.price}
              label={currency ? t('priceIn', { currency }) : t('price')}
              error={error('price')}
            >
              <Input
                id={ids.price}
                inputMode="decimal"
                autoComplete="off"
                value={form.price}
                onChange={(event) => {
                  set({ price: event.target.value });
                }}
              />
            </Field>
            <Field id={ids.fee} label={t('fee')}>
              <Input
                id={ids.fee}
                inputMode="decimal"
                autoComplete="off"
                value={form.fee}
                onChange={(event) => {
                  set({ fee: event.target.value });
                }}
              />
            </Field>
          </>
        )}
        {isDividend && (
          <>
            <Field
              id={ids.amount}
              label={currency ? t('netAmountIn', { currency }) : t('netAmount')}
              error={error('amount')}
            >
              <Input
                id={ids.amount}
                inputMode="decimal"
                autoComplete="off"
                value={form.amount}
                onChange={(event) => {
                  set({ amount: event.target.value });
                }}
              />
            </Field>
            <Field id={ids.gross} label={t('gross')}>
              <Input
                id={ids.gross}
                inputMode="decimal"
                autoComplete="off"
                value={form.gross}
                onChange={(event) => {
                  set({ gross: event.target.value });
                }}
              />
            </Field>
            <Field id={ids.tax} label={t('tax')}>
              <Input
                id={ids.tax}
                inputMode="decimal"
                autoComplete="off"
                value={form.tax}
                onChange={(event) => {
                  set({ tax: event.target.value });
                }}
              />
            </Field>
          </>
        )}
      </div>
      {form.type === 'buy' && (
        <label htmlFor={ids.fromCash} className="flex items-center gap-2 text-md">
          <input
            id={ids.fromCash}
            type="checkbox"
            checked={form.fromCash}
            onChange={(event) => {
              set({ fromCash: event.target.checked });
            }}
          />
          {t('fromCash')}
        </label>
      )}
      <Field id={ids.note} label={t('note')}>
        <textarea
          id={ids.note}
          rows={3}
          maxLength={2000}
          className={textareaClass}
          placeholder={t('notePlaceholder')}
          value={form.note}
          onChange={(event) => {
            set({ note: event.target.value });
          }}
        />
      </Field>
    </FormDialog>
  );
}
