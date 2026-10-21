'use client';

import { Button, Card, formatDate, Input, Select, useToast } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

/** The currencies a pool can use as its base (the ones with an FX rate, NES-46). */
export const BASE_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const NAME_MAX = 60;
// eslint-disable-next-line no-control-regex -- mirrors the server rule: no control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface HouseholdCardProps {
  poolId: string;
  name: string;
  baseCurrency: string;
  /** ISO timestamp of the pool's creation. */
  createdAt: string;
  ownerName: string;
  memberCount: number;
  holderCount: number;
  /** Hiding is cosmetic: the service checks `pool.rename` (and `settings.write`) again. */
  canEdit: boolean;
}

/** Definições → Dados do agregado (mockup 69): name, base currency, creation date and counts. */
export function HouseholdCard(props: HouseholdCardProps) {
  const { poolId, canEdit } = props;
  const t = useTranslations('household');
  const router = useRouter();
  const toast = useToast();
  const ids = { name: useId(), currency: useId() };
  const [name, setName] = useState(props.name);
  const [currency, setCurrency] = useState(props.baseCurrency);
  const [invalid, setInvalid] = useState(false);
  const action = useMemberAction(() => {
    toast.show(t('saved'));
    // The layout (switcher, document title) and this card read the new values from the server.
    router.refresh();
  });

  const refused = action.problem?.status === 400 || action.problem?.status === 403;
  const generic = action.problem !== null && action.problem.status !== 429 && !refused;
  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && trimmed.length <= NAME_MAX && !CONTROL.test(trimmed);
  const base = `/api/v1/pools/${encodeURIComponent(poolId)}`;

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy || !canEdit) return;
    setInvalid(!nameOk);
    if (!nameOk) return;
    void action.run(async () => {
      const renamed =
        trimmed === props.name ? null : await sendJson('PATCH', base, { name: trimmed });
      if (renamed && !renamed.ok) return renamed;
      if (currency === props.baseCurrency) {
        return renamed ?? new Response(null, { status: 204 });
      }
      return sendJson('PATCH', `${base}/settings`, { displayCurrency: currency });
    });
  }

  const line = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 font-medium text-fg-2">{value}</dd>
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
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.name} className="text-sm font-medium text-fg-2">
            {t('name')}
          </label>
          <Input
            id={ids.name}
            value={name}
            maxLength={NAME_MAX}
            readOnly={!canEdit}
            autoComplete="off"
            aria-invalid={invalid || refused}
            onChange={(event) => {
              setName(event.target.value);
              setInvalid(false);
              action.clearProblem();
            }}
          />
          <p className="m-0 text-xs text-fg-3">{t('nameHint')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.currency} className="text-sm font-medium text-fg-2">
              {t('currency')}
            </label>
            <Select
              id={ids.currency}
              value={currency}
              disabled={!canEdit}
              onChange={(event) => {
                setCurrency(event.target.value);
                action.clearProblem();
              }}
            >
              {BASE_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {t(`currencies.${code}`)}
                </option>
              ))}
            </Select>
            <p className="m-0 text-xs text-fg-3">{t('currencyHint')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg-2">{t('createdAt')}</span>
            <Input readOnly aria-label={t('createdAt')} value={formatDate(props.createdAt)} />
          </div>
        </div>
        <dl className="m-0 flex flex-col gap-1.5">
          {line(t('owner'), props.ownerName)}
          {line(t('users'), String(props.memberCount))}
          {line(t('holders'), String(props.holderCount))}
        </dl>
        {canEdit && (
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
