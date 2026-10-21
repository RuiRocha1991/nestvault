'use client';

import { Input, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog } from '@webapp/components/portfolios/form-dialog';
import type { TabContext } from '@webapp/components/portfolios/types';
import { normalizeDecimal, poolApi } from '@webapp/lib/portfolio-forms';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** A regular monthly investment: asset, portfolio, amount and day of the month. */
export function PlanDialog({
  ctx,
  planId,
  onClose,
  onDone,
}: {
  ctx: TabContext;
  planId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.planDialog');
  const ids = {
    asset: useId(),
    portfolio: useId(),
    amount: useId(),
    day: useId(),
    active: useId(),
  };
  const existing = planId ? ctx.plans.find((p) => p.id === planId) : undefined;
  const [assetId, setAssetId] = useState(existing?.assetId ?? '');
  const [portfolio, setPortfolio] = useState(
    existing?.portfolioId ?? ctx.portfolioId ?? ctx.portfolios[0]?.id ?? '',
  );
  const [amount, setAmount] = useState(existing?.amount ?? '');
  const [day, setDay] = useState(existing?.day ?? 1);
  const [active, setActive] = useState(existing?.active ?? true);
  const [missing, setMissing] = useState(false);
  const action = useMemberAction(onDone);

  function submit() {
    const value = normalizeDecimal(amount);
    if (assetId === '' || portfolio === '' || value === '') {
      setMissing(true);
      return;
    }
    const body = { portfolioId: portfolio, assetId, amount: value, day, active };
    void action.run(() =>
      existing
        ? sendJson('PATCH', poolApi(ctx.poolId, 'plans', existing.id), body)
        : postJson(poolApi(ctx.poolId, 'plans'), body),
    );
  }

  return (
    <FormDialog
      title={existing ? t('editTitle') : t('title')}
      submitLabel={existing ? t('save') : t('create')}
      action={action}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field
        id={ids.asset}
        label={t('asset')}
        error={missing && assetId === '' ? t('required') : undefined}
      >
        <Select
          id={ids.asset}
          value={assetId}
          onChange={(event) => {
            setAssetId(event.target.value);
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
      <Field id={ids.portfolio} label={t('portfolio')}>
        <Select
          id={ids.portfolio}
          value={portfolio}
          onChange={(event) => {
            setPortfolio(event.target.value);
          }}
        >
          {ctx.portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          id={ids.amount}
          label={t('amount')}
          error={missing && normalizeDecimal(amount) === '' ? t('required') : undefined}
        >
          <Input
            id={ids.amount}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </Field>
        <Field id={ids.day} label={t('day')}>
          <Select
            id={ids.day}
            value={String(day)}
            onChange={(event) => {
              setDay(Number(event.target.value));
            }}
          >
            {DAYS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label htmlFor={ids.active} className="flex items-center gap-2 text-md">
        <input
          id={ids.active}
          type="checkbox"
          checked={active}
          onChange={(event) => {
            setActive(event.target.checked);
          }}
        />
        {t('active')}
      </label>
    </FormDialog>
  );
}
