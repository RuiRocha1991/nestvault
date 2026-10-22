'use client';

import { formatMoney, Input, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Field } from '@webapp/components/auth/field';
import { FormDialog, textareaClass } from '@webapp/components/portfolios/form-dialog';
import type { TabContext } from '@webapp/components/portfolios/types';
import { normalizeDecimal, poolApi } from '@webapp/lib/portfolio-forms';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

/** Modal 25: moves cash from the portfolio to a bank account (the cash is in EUR). */
export function MoveCashDialog({
  ctx,
  portfolioId,
  today,
  onClose,
  onDone,
}: {
  ctx: TabContext;
  portfolioId: string;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.moveCash');
  const ids = { account: useId(), date: useId(), amount: useId(), note: useId(), mirror: useId() };
  const accounts = ctx.accounts.filter((a) => a.type !== 'brokerage' && a.currency === 'EUR');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [mirror, setMirror] = useState(true);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const action = useMemberAction(onDone);
  const tooMuch = action.problem?.status === 409 || action.problem?.status === 400;

  const tooMuchText = tooMuch ? t('tooMuch', { cash: formatMoney(ctx.summary.cashEur) }) : null;

  function submit() {
    const value = normalizeDecimal(amount);
    if (accountId === '' || value === '') {
      setMissing(true);
      return;
    }
    void action.run(() =>
      postJson(poolApi(ctx.poolId, 'portfolios', portfolioId, 'cash-moves'), {
        accountId,
        date,
        amount: value,
        mirror,
        note: note.trim() === '' ? null : note.trim(),
      }),
    );
  }

  return (
    <FormDialog
      title={t('title')}
      submitLabel={t('submit')}
      action={action}
      fieldProblem={tooMuchText}
      onClose={onClose}
      onSubmit={submit}
    >
      <p className="text-md text-fg-2">
        {t('available', { cash: formatMoney(ctx.summary.cashEur) })}
      </p>
      <Field
        id={ids.account}
        label={t('account')}
        error={missing && accountId === '' ? t('required') : undefined}
      >
        <Select
          id={ids.account}
          value={accountId}
          onChange={(event) => {
            setAccountId(event.target.value);
          }}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4 one:grid-cols-1">
        <Field id={ids.date} label={t('date')}>
          <Input
            id={ids.date}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </Field>
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
              setMissing(false);
            }}
          />
        </Field>
      </div>
      <label htmlFor={ids.mirror} className="flex items-center gap-2 text-md">
        <input
          id={ids.mirror}
          type="checkbox"
          checked={mirror}
          onChange={(event) => {
            setMirror(event.target.checked);
          }}
        />
        {t('mirror')}
      </label>
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
    </FormDialog>
  );
}
