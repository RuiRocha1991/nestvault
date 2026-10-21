'use client';

import { Button, Input, Modal, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { AccountView, CategoryView, RuleView } from '@webapp/lib/expenses-types';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';
import { useCategoryLabel } from './use-category-label';

export interface RuleDialogProps {
  poolId: string;
  /** The rule being edited; absent when adding one. */
  rule?: Pick<RuleView, 'id' | 'keyword' | 'categoryId' | 'accountId'>;
  /** What a new rule starts with (a movement's keyword suggestion and category). */
  initial?: { keyword: string; categoryId: string | null };
  /** Set when the keyword comes from a movement, so the dialog says so. */
  suggested?: boolean;
  categories: readonly CategoryView[];
  accounts: readonly Pick<AccountView, 'id' | 'name'>[];
  onClose: () => void;
  onDone: () => void;
}

/** New or edited keyword rule. The body carries the keyword, category and account only. */
export function RuleDialog({
  poolId,
  rule,
  initial,
  suggested = false,
  categories,
  accounts,
  onClose,
  onDone,
}: RuleDialogProps) {
  const t = useTranslations('expenses.rules');
  const tc = useTranslations('expenses');
  const label = useCategoryLabel();
  const ids = { form: useId(), keyword: useId(), category: useId(), account: useId() };
  const [keyword, setKeyword] = useState(rule?.keyword ?? initial?.keyword ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? initial?.categoryId ?? '');
  const [accountId, setAccountId] = useState(rule?.accountId ?? '');
  const [errors, setErrors] = useState<{ keyword?: string; category?: string }>({});
  const action = useMemberAction(onDone);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const found: typeof errors = {};
    if (keyword.trim().length < 2) found.keyword = t('keywordRequired');
    if (!categoryId) found.category = t('categoryRequired');
    setErrors(found);
    if (found.keyword || found.category) return;
    const body = {
      keyword: keyword.trim(),
      categoryId,
      accountId: accountId === '' ? null : accountId,
    };
    const base = `/api/v1/pools/${encodeURIComponent(poolId)}/rules`;
    void action.run(() =>
      rule
        ? sendJson('PATCH', `${base}/${encodeURIComponent(rule.id)}`, body)
        : postJson(base, body),
    );
  }

  const visible = categories.filter((category) => !category.hidden || category.id === categoryId);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={rule ? t('editTitle') : t('newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={action.busy}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} />
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.keyword} className="text-sm font-medium text-fg-2">
            {t('keyword')}
          </label>
          <Input
            id={ids.keyword}
            autoComplete="off"
            maxLength={60}
            className="font-mono"
            value={keyword}
            aria-invalid={!!errors.keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setErrors({});
              action.clearProblem();
            }}
          />
          <p className={errors.keyword ? 'text-sm text-neg' : 'text-sm text-fg-3'}>
            {errors.keyword ?? (suggested ? t('suggestion') : t('keywordHint'))}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.category} className="text-sm font-medium text-fg-2">
            {t('categoryField')}
          </label>
          <Select
            id={ids.category}
            value={categoryId}
            aria-invalid={!!errors.category}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setErrors({});
            }}
          >
            <option value="" />
            {visible.map((category) => (
              <option key={category.id} value={category.id}>
                {label(category)}
              </option>
            ))}
          </Select>
          {!!errors.category && <p className="text-sm text-neg">{errors.category}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.account} className="text-sm font-medium text-fg-2">
            {t('accountField')}
          </label>
          <Select
            id={ids.account}
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
            }}
          >
            <option value="">{t('everyAccount')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}
