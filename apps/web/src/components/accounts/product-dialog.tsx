'use client';

import { Button, Modal, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field } from '@webapp/components/auth/field';
import {
  emptyProductForm,
  productBody,
  serverFields,
  validateProduct,
  type FormErrors,
  type ProductField,
  type ProductForm,
} from '@webapp/lib/account-form';
import type {
  AccountCard as AccountCardDto,
  SavingsProduct as ProductDto,
} from '@webapp/lib/accounts-types';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { FormRow, Hint, PeriodField, TextField } from './form-parts';

export interface ProductDialogProps {
  poolId: string;
  /** The product being edited; absent when creating one. */
  product?: ProductDto;
  accounts: readonly AccountCardDto[];
  /** Institutions already in use, offered as suggestions. */
  institutions: readonly string[];
  onClose: () => void;
  onDone: () => void;
}

const toForm = (product: ProductDto): ProductForm => ({
  name: product.name,
  institution: product.institution ?? '',
  rate: product.rate,
  tax: product.tax ?? '',
  payN: product.payN === null ? '' : String(product.payN),
  payU: product.payU ?? 'm',
  termN: product.termN === null ? '' : String(product.termN),
  termU: product.termU ?? 'm',
  payToAccountId: product.payToAccountId ?? '',
  fundFromAccountId: product.fundFromAccountId ?? '',
});

/** Modal 19: the terms a bank offers, copied into each deposit that uses the product. */
export function ProductDialog({
  poolId,
  product,
  accounts,
  institutions,
  onClose,
  onDone,
}: ProductDialogProps) {
  const t = useTranslations('accounts.productDialog');
  const dialog = useTranslations('accounts.dialog');
  const formId = useId();
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const [form, setForm] = useState<ProductForm>(() =>
    product ? toForm(product) : emptyProductForm(),
  );
  const [errors, setErrors] = useState<FormErrors<ProductField>>({});
  const action = useMemberAction(onDone);

  const fromServer =
    action.problem?.status === 400 ? serverFields(action.problem.issuePaths) : null;
  const generic = action.problem !== null && action.problem.status !== 429;
  const patch = (change: Partial<ProductForm>) => {
    setForm((current) => ({ ...current, ...change }));
    action.clearProblem();
  };
  const problem = (field: ProductField, required: string, invalid: string) => {
    const found = errors[field];
    if (found === 'required') return required;
    if (found === 'invalid' || !!fromServer?.has(field)) return invalid;
    return undefined;
  };
  const targets = accounts.filter((one) => one.type !== 'term_deposit');

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const found = validateProduct(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const root = `/api/v1/pools/${encodeURIComponent(poolId)}/products`;
    const body = productBody(form);
    void action.run(() =>
      product
        ? sendJson('PATCH', `${root}/${encodeURIComponent(product.id)}`, body)
        : postJson(root, body),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={product ? t('editTitle') : t('newTitle')}
      closeLabel={dialog('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {dialog('cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={action.busy}>
            {dialog('submit')}
          </Button>
        </>
      }
    >
      {generic && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {action.locked > 0 && (
        <LockedAlert
          title={dialog('lockedTitle')}
          text={dialog.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          id={id('name')}
          label={t('name')}
          maxLength={80}
          placeholder={t('namePlaceholder')}
          value={form.name}
          error={problem('name', t('nameRequired'), t('nameRequired'))}
          onChange={(event) => {
            patch({ name: event.target.value });
          }}
        />
        <FormRow>
          <TextField
            id={id('institution')}
            label={t('institution')}
            maxLength={80}
            list={id('institutions')}
            value={form.institution}
            onChange={(event) => {
              patch({ institution: event.target.value });
            }}
          />
          <datalist id={id('institutions')}>
            {institutions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <TextField
            id={id('rate')}
            label={t('rate')}
            inputMode="decimal"
            value={form.rate}
            error={problem('rate', t('rateRequired'), t('rateInvalid'))}
            onChange={(event) => {
              patch({ rate: event.target.value });
            }}
          />
        </FormRow>
        <FormRow>
          <TextField
            id={id('tax')}
            label={t('tax')}
            inputMode="decimal"
            hint={t('taxHint')}
            value={form.tax}
            error={problem('tax', t('taxInvalid'), t('taxInvalid'))}
            onChange={(event) => {
              patch({ tax: event.target.value });
            }}
          />
          <PeriodField
            id={id('pay')}
            label={t('paysEvery')}
            hint={t('paysHint')}
            error={problem('pay', t('periodInvalid'), t('periodInvalid'))}
            amount={form.payN}
            unit={form.payU}
            onAmount={(payN) => {
              patch({ payN });
            }}
            onUnit={(payU) => {
              patch({ payU });
            }}
          />
        </FormRow>
        <FormRow>
          <PeriodField
            id={id('term')}
            label={t('term')}
            hint={t('termHint')}
            error={problem('term', t('periodInvalid'), t('periodInvalid'))}
            amount={form.termN}
            unit={form.termU}
            onAmount={(termN) => {
              patch({ termN });
            }}
            onUnit={(termU) => {
              patch({ termU });
            }}
          />
          <Field id={id('payTo')} label={t('interestGoesTo')}>
            <Select
              id={id('payTo')}
              value={form.payToAccountId}
              onChange={(event) => {
                patch({ payToAccountId: event.target.value });
              }}
            >
              <option value="">{dialog('interestStays')}</option>
              {targets.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </Select>
            <Hint>{t('interestHint')}</Hint>
          </Field>
        </FormRow>
        <Field id={id('fund')} label={t('fundFrom')}>
          <Select
            id={id('fund')}
            value={form.fundFromAccountId}
            onChange={(event) => {
              patch({ fundFromAccountId: event.target.value });
            }}
          >
            <option value="">{dialog('fundNone')}</option>
            {targets.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </Select>
          <Hint>{t('fundHint')}</Hint>
        </Field>
      </form>
    </Modal>
  );
}
