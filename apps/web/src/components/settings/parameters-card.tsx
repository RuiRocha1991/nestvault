'use client';

import { Button, Card, formatDate, Input, useToast } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import {
  buildPatch,
  FX_CURRENCIES,
  toText,
  type FxCurrency,
  type FxRateView,
  type ParametersForm,
} from '@webapp/lib/parameters-form';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

export interface ParametersCardProps {
  poolId: string;
  settings: {
    transferWindowDays: number;
    depositTax: string;
    dividendTax: string;
    fxOverrides: Readonly<Record<string, string>>;
  };
  /** The rate in force and the market rate of each currency (EUR per unit), as decimal strings. */
  rates: Readonly<Record<FxCurrency, FxRateView>>;
  /** Hiding is cosmetic: the service checks `settings.write` again. */
  canWrite: boolean;
}

/** Definições → Parâmetros: FX rates, taxes and the transfer window of the pool (PRD 04). */
export function ParametersCard({ poolId, settings, rates, canWrite }: ParametersCardProps) {
  const t = useTranslations('parameters');
  const router = useRouter();
  const toast = useToast();
  const ids = {
    form: useId(),
    USD: useId(),
    GBP: useId(),
    CHF: useId(),
    deposit: useId(),
    dividend: useId(),
    window: useId(),
  };
  const [form, setForm] = useState<ParametersForm>(() => ({
    rates: {
      USD: toText(rates.USD.rate),
      GBP: toText(rates.GBP.rate),
      CHF: toText(rates.CHF.rate),
    },
    depositTax: toText(settings.depositTax),
    dividendTax: toText(settings.dividendTax),
    transferWindowDays: String(settings.transferWindowDays),
  }));
  const [invalid, setInvalid] = useState(false);
  const action = useMemberAction(() => {
    toast.show(t('saved'));
    router.refresh();
  });

  const refused = action.problem?.status === 400;
  const generic = action.problem !== null && action.problem.status !== 429 && !refused;

  function change(update: (current: ParametersForm) => ParametersForm) {
    setForm(update);
    setInvalid(false);
    action.clearProblem();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy || !canWrite) return;
    const market = Object.fromEntries(FX_CURRENCIES.map((ccy) => [ccy, rates[ccy].marketRate]));
    const patch = buildPatch(form, market, settings.fxOverrides);
    setInvalid(patch === null);
    if (patch === null) return;
    void action.run(() =>
      sendJson('PATCH', `/api/v1/pools/${encodeURIComponent(poolId)}/settings`, patch),
    );
  }

  const field = (id: string, label: string, value: string, set: (value: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg-2">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        readOnly={!canWrite}
        aria-invalid={invalid || refused}
        onChange={(event) => {
          set(event.target.value);
        }}
      />
    </div>
  );

  return (
    <Card>
      <h2 className="m-0 text-lg font-semibold">{t('title')}</h2>
      {(refused || invalid) && <ProblemAlert title={t('invalidTitle')} text={t('invalidText')} />}
      {generic && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FX_CURRENCIES.map((ccy) => (
            <Fragment key={ccy}>
              <div className="flex flex-col gap-1.5">
                {field(ids[ccy], t('rate', { currency: ccy }), form.rates[ccy], (value) => {
                  change((current) => ({ ...current, rates: { ...current.rates, [ccy]: value } }));
                })}
                <p className="m-0 text-xs text-fg-3">
                  {rates[ccy].date === null
                    ? t(`fxSource.${rates[ccy].source}`)
                    : t('fxSourceDate', {
                        source: t(`fxSource.${rates[ccy].source}`),
                        date: formatDate(rates[ccy].date),
                      })}
                </p>
              </div>
            </Fragment>
          ))}
          <div className="flex flex-col gap-1.5">
            {field(ids.deposit, t('depositTax'), form.depositTax, (value) => {
              change((current) => ({ ...current, depositTax: value }));
            })}
            <p className="m-0 text-xs text-fg-3">{t('depositTaxHint')}</p>
          </div>
          {field(ids.dividend, t('dividendTax'), form.dividendTax, (value) => {
            change((current) => ({ ...current, dividendTax: value }));
          })}
          {field(ids.window, t('transferWindow'), form.transferWindowDays, (value) => {
            change((current) => ({ ...current, transferWindowDays: value }));
          })}
        </div>
        <p className="m-0 text-sm text-fg-3">{t('ratesHint')}</p>
        {canWrite && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={action.busy}>
              {t('save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
