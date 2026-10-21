'use client';

import { Button, Input, Modal, Segmented, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { AccountView, CategoryView } from '@webapp/lib/expenses-types';
import { parseAmountText } from '@webapp/lib/expenses-view';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';
import { useCategoryLabel } from './use-category-label';

export interface MovementDialogProps {
  poolId: string;
  accounts: readonly Pick<AccountView, 'id' | 'name' | 'currency'>[];
  categories: readonly CategoryView[];
  /** The day the date field starts with (`yyyy-mm-dd`). */
  today: string;
  onClose: () => void;
  onDone: () => void;
}

type Sign = 'expense' | 'income';

/**
 * Manual movement. The body carries only the fields of the form: the pool comes from the URL, the
 * rules choose the category when none is picked, and the server decides who may write
 * (`transactions.write`).
 */
export function MovementDialog({
  poolId,
  accounts,
  categories,
  today,
  onClose,
  onDone,
}: MovementDialogProps) {
  const t = useTranslations('expenses.newMovementDialog');
  const tc = useTranslations('expenses');
  const label = useCategoryLabel();
  const ids = {
    form: useId(),
    account: useId(),
    date: useId(),
    description: useId(),
    amount: useId(),
    category: useId(),
  };
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [sign, setSign] = useState<Sign>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useMemberAction(onDone);

  const currency = accounts.find((account) => account.id === accountId)?.currency ?? 'EUR';

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const parsed = parseAmountText(amount);
    const found: Record<string, string> = {};
    if (!accountId) found.account = t('accountRequired');
    if (!date) found.date = t('dateRequired');
    if (description.trim() === '') found.description = t('descriptionRequired');
    if (parsed === null) found.amount = t('amountInvalid');
    setErrors(found);
    if (Object.keys(found).length > 0 || parsed === null) return;
    const body = {
      accountId,
      date,
      description: description.trim(),
      amount: sign === 'expense' ? `-${parsed}` : parsed,
      ...(categoryId ? { categoryId } : {}),
    };
    void action.run(() =>
      postJson(`/api/v1/pools/${encodeURIComponent(poolId)}/transactions`, body),
    );
  }

  const clear = (key: string) => {
    setErrors((current) => ({ ...current, [key]: '' }));
    action.clearProblem();
  };

  const field = (key: string, id: string, text: string, children: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg-2">
        {text}
      </label>
      {children}
      {!!errors[key] && (
        <p role="alert" className="text-sm text-neg">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form={ids.form}
            variant="primary"
            disabled={action.busy || accounts.length === 0}
          >
            {t('submit')}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} />
      {accounts.length === 0 ? (
        <p className="text-fg-2">{t('noAccounts')}</p>
      ) : (
        <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {field(
            'account',
            ids.account,
            t('account'),
            <Select
              id={ids.account}
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                clear('account');
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>,
          )}
          <div className="grid grid-cols-2 gap-4 one:grid-cols-1">
            {field(
              'date',
              ids.date,
              t('date'),
              <Input
                id={ids.date}
                type="date"
                value={date}
                aria-invalid={!!errors.date}
                onChange={(event) => {
                  setDate(event.target.value);
                  clear('date');
                }}
              />,
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg-2">{t('type')}</span>
              <Segmented<Sign>
                label={t('type')}
                value={sign}
                options={[
                  { value: 'expense', label: t('expense') },
                  { value: 'income', label: t('income') },
                ]}
                onChange={setSign}
              />
            </div>
          </div>
          {field(
            'description',
            ids.description,
            t('description'),
            <Input
              id={ids.description}
              autoComplete="off"
              maxLength={500}
              placeholder={t('descriptionPlaceholder')}
              value={description}
              aria-invalid={!!errors.description}
              onChange={(event) => {
                setDescription(event.target.value);
                clear('description');
              }}
            />,
          )}
          {field(
            'amount',
            ids.amount,
            `${t('amount')} (${currency})`,
            <Input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder={t('amountPlaceholder')}
              value={amount}
              aria-invalid={!!errors.amount}
              onChange={(event) => {
                setAmount(event.target.value);
                clear('amount');
              }}
            />,
          )}
          {field(
            'category',
            ids.category,
            t('category'),
            <Select
              id={ids.category}
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
              }}
            >
              <option value="">{t('automatic')}</option>
              {categories
                .filter((category) => !category.hidden)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {label(category)}
                  </option>
                ))}
            </Select>,
          )}
        </form>
      )}
    </Modal>
  );
}
