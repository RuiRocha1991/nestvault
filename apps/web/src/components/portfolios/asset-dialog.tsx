'use client';

import { cn, Input, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog } from '@webapp/components/portfolios/form-dialog';
import type { TabContext } from '@webapp/components/portfolios/types';
import { decimalOrNull, normalizeDecimal, poolApi } from '@webapp/lib/portfolio-forms';
import { monthLabel } from '@webapp/lib/portfolios-view';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

const TYPES = ['stock', 'etf', 'fund', 'reit', 'ppr', 'bond', 'crypto', 'other'] as const;
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Modal 23: a new asset (ticker, type, currency, sector, region, dividend) or the edit of one. */
export function AssetDialog({
  ctx,
  today,
  assetId,
  onClose,
  onDone,
}: {
  ctx: TabContext;
  today: string;
  assetId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.assetDialog');
  const ids = {
    ticker: useId(),
    name: useId(),
    type: useId(),
    currency: useId(),
    sector: useId(),
    region: useId(),
    dps: useId(),
    price: useId(),
  };
  const existing = assetId ? ctx.assetsById.get(assetId) : undefined;
  const [ticker, setTicker] = useState(existing?.ticker ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<string>(existing?.type ?? 'etf');
  const [currency, setCurrency] = useState(existing?.currency ?? 'EUR');
  const [sector, setSector] = useState(existing?.sector ?? '');
  const [region, setRegion] = useState(existing?.region ?? '');
  const [dps, setDps] = useState(existing?.dps ?? '');
  const [months, setMonths] = useState<readonly number[]>(existing?.divMonths ?? []);
  const [price, setPrice] = useState('');
  const [missing, setMissing] = useState(false);
  const action = useMemberAction(onDone);
  const conflict = action.problem?.status === 409 ? t('duplicate') : null;

  function submit() {
    if (ticker.trim() === '' || name.trim() === '') {
      setMissing(true);
      return;
    }
    const body = {
      ticker: ticker.trim(),
      name: name.trim(),
      type,
      currency,
      sector: sector.trim() === '' ? null : sector.trim(),
      region: region.trim() === '' ? null : region.trim(),
      dps: decimalOrNull(dps),
      divMonths: [...months],
    };
    void action.run(async () => {
      if (existing) return sendJson('PATCH', poolApi(ctx.poolId, 'assets', existing.id), body);
      const created = await postJson(poolApi(ctx.poolId, 'assets'), body);
      const typed = normalizeDecimal(price);
      if (created.ok && typed !== '') {
        const { id } = (await created.clone().json()) as { id: string };
        await postJson(poolApi(ctx.poolId, 'assets', id, 'prices'), { date: today, price: typed });
      }
      return created;
    });
  }

  const touch = (change: () => void) => {
    change();
    setMissing(false);
    action.clearProblem();
  };

  return (
    <FormDialog
      wide
      title={existing ? t('editTitle') : t('title')}
      submitLabel={existing ? t('save') : t('create')}
      action={action}
      fieldProblem={conflict}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="grid grid-cols-2 gap-4 one:grid-cols-1">
        <Field
          id={ids.ticker}
          label={t('ticker')}
          error={missing && ticker.trim() === '' ? t('required') : undefined}
        >
          <Input
            id={ids.ticker}
            autoComplete="off"
            maxLength={20}
            value={ticker}
            onChange={(event) => {
              touch(() => {
                setTicker(event.target.value);
              });
            }}
          />
        </Field>
        <Field
          id={ids.name}
          label={t('name')}
          error={missing && name.trim() === '' ? t('required') : undefined}
        >
          <Input
            id={ids.name}
            autoComplete="off"
            maxLength={80}
            value={name}
            onChange={(event) => {
              touch(() => {
                setName(event.target.value);
              });
            }}
          />
        </Field>
        <Field id={ids.type} label={t('type')}>
          <Select
            id={ids.type}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`types.${value}`)}
              </option>
            ))}
          </Select>
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
        <Field id={ids.sector} label={t('sector')}>
          <Input
            id={ids.sector}
            autoComplete="off"
            maxLength={40}
            value={sector}
            onChange={(event) => {
              setSector(event.target.value);
            }}
          />
        </Field>
        <Field id={ids.region} label={t('region')}>
          <Input
            id={ids.region}
            autoComplete="off"
            maxLength={40}
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
          />
        </Field>
        <Field id={ids.dps} label={t('dps', { currency })}>
          <Input
            id={ids.dps}
            inputMode="decimal"
            autoComplete="off"
            value={dps}
            onChange={(event) => {
              setDps(event.target.value);
            }}
          />
        </Field>
        {!existing && (
          <Field id={ids.price} label={t('price', { currency })}>
            <Input
              id={ids.price}
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
              }}
            />
          </Field>
        )}
      </div>
      <fieldset className="flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-sm font-medium text-fg-2">{t('divMonths')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {MONTHS.map((month) => {
            const on = months.includes(month);
            return (
              <button
                key={month}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setMonths((current) =>
                    on
                      ? current.filter((m) => m !== month)
                      : [...current, month].sort((a, b) => a - b),
                  );
                }}
                className={cn(
                  'h-[28px] min-w-[44px] rounded-sm border px-2 text-sm font-semibold',
                  on
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-line-2 bg-panel-2 text-fg-2 hover:text-fg',
                )}
              >
                {monthLabel(`2000-${String(month).padStart(2, '0')}`)}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-fg-3">{t('divMonthsHint')}</p>
      </fieldset>
    </FormDialog>
  );
}
