'use client';

import { Button, Input, Modal, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { fieldKeyFor } from '@webapp/lib/real-estate-view';

/** Modal 46: a custom field of the installment (a name, how it counts, a default and a start). */
export function InstallmentFieldDialog({
  open,
  onOpenChange,
  poolId,
  loanId,
  takenKeys,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poolId: string;
  loanId: string;
  takenKeys: readonly string[];
  /** Today in Lisbon (`yyyy-mm-dd`): the default start of the field. */
  today: string;
  onSaved: () => void;
}) {
  const t = useTranslations('realEstate.installments.fieldDialog');
  const [name, setName] = useState('');
  const [counts, setCounts] = useState<'expense' | 'other'>('expense');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(today);
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'invalid' | 'forbidden' | 'error' | null>(null);

  async function save() {
    const label = name.trim();
    const value = amount.trim().replace(',', '.');
    if (busy) return;
    if (!label || label.length > 60 || (value !== '' && !/^\d+(\.\d{1,4})?$/.test(value))) {
      setProblem('invalid');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(
        `/api/v1/pools/${encodeURIComponent(poolId)}/loans/${encodeURIComponent(loanId)}/fields`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: fieldKeyFor(label, takenKeys),
            label,
            countsAsExpense: counts === 'expense',
            defaultAmount: value === '' ? null : value,
            appliesFrom: from || null,
            enabled: show,
          }),
        },
      );
      if (response.ok) {
        setName('');
        setAmount('');
        onOpenChange(false);
        onSaved();
      } else {
        setProblem(response.status === 403 ? 'forbidden' : 'error');
      }
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {t('name')}
        <Input
          maxLength={60}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {t('counts')}
        <Select
          value={counts}
          onChange={(event) => {
            setCounts(event.target.value === 'other' ? 'other' : 'expense');
          }}
        >
          <option value="expense">{t('countsExpense')}</option>
          <option value="other">{t('countsOther')}</option>
        </Select>
        <span className="text-xs font-normal text-fg-3">
          {t(counts === 'expense' ? 'countsExpenseHint' : 'countsOtherHint')}
        </span>
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('amount')}
          <Input
            inputMode="decimal"
            className="text-right"
            placeholder={t('amountPlaceholder')}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
          <span className="text-xs font-normal text-fg-3">{t('amountHint')}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('from')}
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-md">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={show}
          onChange={(event) => {
            setShow(event.target.checked);
          }}
        />
        {t('show')}
      </label>
      <div className="rounded-md bg-inset p-3 text-sm text-fg-2">
        <b className="text-fg">{t('whatChanges')}</b>
        <ul className="m-0 mt-1 list-disc pl-5">
          <li>{t('changeColumn')}</li>
          <li>{t('changeTotals')}</li>
          <li>{t('changePaid')}</li>
        </ul>
      </div>
      {!!problem && (
        <p role="alert" className="m-0 text-sm text-neg">
          {t(`problem.${problem}`)}
        </p>
      )}
    </Modal>
  );
}
