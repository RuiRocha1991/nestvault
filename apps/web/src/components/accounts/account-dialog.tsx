'use client';

import { Button, Modal, Select, formatDate } from '@nestvault/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field } from '@webapp/components/auth/field';
import {
  accountBody,
  ACCOUNT_TYPES,
  CURRENCIES,
  defaultDepositName,
  depositBody,
  emptyAccountForm,
  serverFields,
  validateAccount,
  type AccountForm,
  type AccountType,
  type FormErrors,
  type AccountField,
} from '@webapp/lib/account-form';
import type {
  AccountCard as AccountCardDto,
  PortfolioOption as PortfolioDto,
  SavingsProduct as ProductDto,
} from '@webapp/lib/accounts-types';
import { accountToForm } from '@webapp/lib/accounts-view';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import type { HolderView } from '../holders/holder-dialog';

import { FormRow, Hint, PeriodField, TextField, invalidClass } from './form-parts';

export interface AccountDialogProps {
  poolId: string;
  /** The account being edited; absent when creating one. */
  account?: AccountCardDto;
  /** A new deposit started from a product: the type and the product come filled. */
  fromProductId?: string;
  holders: readonly HolderView[];
  portfolios: readonly PortfolioDto[];
  products: readonly ProductDto[];
  /** Every account, for the "interest goes to" and "capital comes from" lists. */
  accounts: readonly AccountCardDto[];
  onNewPerson: () => void;
  onClose: () => void;
  onDone: () => void;
}

const base = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}`;

/** The first failed answer, or the last one: a request in several steps stops at the first failure. */
async function inSteps(steps: readonly (() => Promise<Response>)[]): Promise<Response> {
  let last: Response | undefined;
  for (const step of steps) {
    last = await step();
    if (!last.ok) return last;
  }
  if (!last) throw new Error('No steps');
  return last;
}

/**
 * Modals 17 and 18: a new or edited account. A term deposit is an account plus its deposit (two
 * requests; when the deposit fails the account is removed again). A brokerage account has its
 * sub-accounts and the "register cash" switch. The body carries only editable fields: the pool is
 * in the URL and the server decides who may write (`accounts.write`).
 */
export function AccountDialog({
  poolId,
  account,
  fromProductId,
  holders,
  portfolios,
  products,
  accounts,
  onNewPerson,
  onClose,
  onDone,
}: AccountDialogProps) {
  const t = useTranslations('accounts.dialog');
  const types = useTranslations('accounts.typeOptions');
  const formId = useId();
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;

  const [form, setForm] = useState<AccountForm>(() => {
    if (account) return accountToForm(account);
    const starter = emptyAccountForm(fromProductId ? 'term_deposit' : 'checking');
    const product = products.find((one) => one.id === fromProductId);
    return product ? applyProduct(starter, product) : starter;
  });
  const [errors, setErrors] = useState<FormErrors<AccountField>>({});
  const action = useMemberAction(onDone);

  const editing = !!account;
  const isTerm = form.type === 'term_deposit';
  const isBroker = form.type === 'brokerage';
  const isSavings = form.type === 'savings';
  const fromServer =
    action.problem?.status === 400 ? serverFields(action.problem.issuePaths) : null;
  const serverIban = !!fromServer?.has('iban');
  const serverRate = !!fromServer?.has('rate');
  const conflict = action.problem?.status === 409;
  const forbidden = action.problem?.status === 403;
  const generic = action.problem !== null && action.problem.status !== 429 && !serverIban;

  const patch = (change: Partial<AccountForm>) => {
    setForm((current) => ({ ...current, ...change }));
    action.clearProblem();
  };
  const message = (
    problem: 'required' | 'invalid' | undefined,
    required: string,
    invalid: string,
  ) => (problem === 'required' ? required : problem === 'invalid' ? invalid : undefined);

  function toggleHolder(holderId: string) {
    const has = form.holderIds.includes(holderId);
    patch({
      holderIds: has
        ? form.holderIds.filter((one) => one !== holderId)
        : [...form.holderIds, holderId],
    });
  }

  function chooseProduct(productId: string) {
    const product = products.find((one) => one.id === productId);
    patch(product ? applyProduct(form, product) : { productId: '' });
  }

  const otherAccounts = accounts.filter(
    (one) => one.id !== account?.id && one.type !== 'term_deposit',
  );
  const ownersOfAccount = holders.filter((holder) => form.holderIds.includes(holder.id));

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const found = validateAccount(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const root = base(poolId);
    const name =
      form.name.trim() === ''
        ? defaultDepositName(
            products.find((one) => one.id === form.productId)?.name,
            formatDate(form.start),
          )
        : form.name;
    const named = { ...form, name };

    void action.run(async () => {
      if (!account) {
        const created = await postJson(`${root}/accounts`, accountBody(named, 'create'));
        if (!created.ok || !isTerm) return created;
        const { id: accountId } = (await created.json()) as { id: string };
        const deposit = await postJson(`${root}/deposits`, { accountId, ...depositBody(named) });
        if (!deposit.ok) {
          await sendJson('DELETE', `${root}/accounts/${encodeURIComponent(accountId)}`);
        }
        return deposit;
      }
      const accountPath = `${root}/accounts/${encodeURIComponent(account.id)}`;
      const steps: (() => Promise<Response>)[] = [
        () => sendJson('PATCH', accountPath, accountBody(named, 'update')),
      ];
      if (isTerm && account.term) {
        const depositPath = `${root}/deposits/${encodeURIComponent(account.term.depositId)}`;
        steps.push(() => sendJson('PATCH', depositPath, depositBody(named)));
      }
      if (isBroker) steps.push(...subAccountSteps(accountPath, account, form));
      return inSteps(steps);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={action.busy}>
            {t('submit')}
          </Button>
        </>
      }
    >
      {generic && (
        <ProblemAlert
          title={t('errorTitle')}
          text={conflict ? t('conflictText') : forbidden ? t('forbiddenText') : t('errorText')}
        />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field id={id('type')} label={t('type')}>
          <Select
            id={id('type')}
            value={form.type}
            disabled={editing}
            onChange={(event) => {
              patch({ type: event.target.value as AccountType });
            }}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {types(type === 'term_deposit' ? 'termDeposit' : type)}
              </option>
            ))}
          </Select>
        </Field>

        <FormRow>
          <TextField
            id={id('name')}
            label={t('name')}
            maxLength={80}
            placeholder={isTerm ? t('namePlaceholderTerm') : ''}
            value={form.name}
            error={message(errors.name, t('nameRequired'), t('nameRequired'))}
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
          />
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
            {[
              ...new Set([
                ...accounts.map((one) => one.institution),
                ...products.map((one) => one.institution),
              ]),
            ]
              .filter((name): name is string => !!name)
              .map((name) => (
                <option key={name} value={name} />
              ))}
          </datalist>
        </FormRow>

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-sm font-medium text-fg-2">{t('holders')}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {holders.map((holder) => (
              <label key={holder.id} className="flex cursor-pointer items-center gap-2 text-md">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={form.holderIds.includes(holder.id)}
                  onChange={() => {
                    toggleHolder(holder.id);
                  }}
                />
                <span
                  aria-hidden
                  className="grid size-5 place-items-center rounded-full text-xs font-bold text-white"
                  style={{ background: holder.color }}
                >
                  {holder.name.trim().charAt(0).toUpperCase()}
                </span>
                {holder.name}
              </label>
            ))}
            <Button variant="ghost" size="sm" onClick={onNewPerson}>
              <Plus aria-hidden />
              {t('newPerson')}
            </Button>
          </div>
          <Hint error={!!errors.holderIds}>
            {errors.holderIds ? t('holdersRequired') : t('holdersHint')}
          </Hint>
        </fieldset>

        {(isTerm || isSavings) && (
          <TextField
            id={id('group')}
            label={t('group')}
            maxLength={60}
            placeholder={t('groupPlaceholder')}
            hint={t('groupHint')}
            value={form.groupName}
            onChange={(event) => {
              patch({ groupName: event.target.value });
            }}
          />
        )}

        {(isTerm || isSavings) && (
          <Field id={id('portfolio')} label={t('portfolio')}>
            <Select
              id={id('portfolio')}
              value={form.portfolioId}
              onChange={(event) => {
                patch({ portfolioId: event.target.value });
              }}
            >
              <option value="">{t('portfolioNone')}</option>
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </Select>
            <Hint>{t('portfolioHint')}</Hint>
          </Field>
        )}

        {isTerm && (
          <>
            <FormRow>
              <TextField
                id={id('rate')}
                label={t('rate')}
                inputMode="decimal"
                value={form.rate}
                error={message(errors.rate, t('rateRequired'), t('rateInvalid'))}
                onChange={(event) => {
                  patch({ rate: event.target.value });
                }}
              />
              <TextField
                id={id('capital')}
                label={t('capital')}
                inputMode="decimal"
                value={form.capital}
                error={message(errors.capital, t('capitalRequired'), t('capitalInvalid'))}
                onChange={(event) => {
                  patch({ capital: event.target.value });
                }}
              />
            </FormRow>
            <FormRow>
              <TextField
                id={id('start')}
                label={t('start')}
                type="date"
                value={form.start}
                error={message(errors.start, t('startRequired'), t('dateInvalid'))}
                onChange={(event) => {
                  patch({ start: event.target.value });
                }}
              />
            </FormRow>
            <Field id={id('product')} label={t('product')}>
              <Select
                id={id('product')}
                value={form.productId}
                onChange={(event) => {
                  chooseProduct(event.target.value);
                }}
              >
                <option value="">{t('productNone')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
              <Hint>{t('productHint')}</Hint>
            </Field>
            <FormRow>
              <PeriodField
                id={id('pay')}
                label={t('paysEvery')}
                hint={t('paysHint')}
                error={message(errors.pay, t('periodInvalid'), t('periodInvalid'))}
                amount={form.payN}
                unit={form.payU}
                onAmount={(payN) => {
                  patch({ payN });
                }}
                onUnit={(payU) => {
                  patch({ payU });
                }}
              />
              <PeriodField
                id={id('term')}
                label={t('term')}
                hint={t('termHint')}
                error={message(errors.term, t('periodInvalid'), t('periodInvalid'))}
                amount={form.termN}
                unit={form.termU}
                onAmount={(termN) => {
                  patch({ termN });
                }}
                onUnit={(termU) => {
                  patch({ termU });
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
                error={message(errors.tax, t('taxInvalid'), t('taxInvalid'))}
                onChange={(event) => {
                  patch({ tax: event.target.value });
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
                  <option value="">{t('interestStays')}</option>
                  {otherAccounts.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </Select>
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
                <option value="">{t('fundNone')}</option>
                {otherAccounts.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {!isTerm && (
          <>
            <FormRow>
              <TextField
                id={id('iban')}
                label={t('iban')}
                placeholder={t('ibanPlaceholder')}
                hint={t('ibanHint')}
                className="font-mono"
                value={form.iban}
                error={serverIban ? t('ibanInvalid') : undefined}
                onChange={(event) => {
                  patch({ iban: event.target.value });
                }}
              />
              <Field id={id('currency')} label={t('currency')}>
                <Select
                  id={id('currency')}
                  value={form.currency}
                  onChange={(event) => {
                    patch({ currency: event.target.value });
                  }}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormRow>
            {isSavings && (
              <TextField
                id={id('rate')}
                label={t('rate')}
                inputMode="decimal"
                value={form.rate}
                error={errors.rate || serverRate ? t('rateInvalid') : undefined}
                onChange={(event) => {
                  patch({ rate: event.target.value });
                }}
              />
            )}
            <FormRow>
              <TextField
                id={id('opening')}
                label={t('opening')}
                inputMode="decimal"
                hint={t('openingHint')}
                value={form.opening}
                error={message(errors.opening, t('numberInvalid'), t('numberInvalid'))}
                onChange={(event) => {
                  patch({ opening: event.target.value });
                }}
              />
              <TextField
                id={id('openingDate')}
                label={t('openingDate')}
                type="date"
                value={form.openingDate}
                error={message(errors.openingDate, t('dateInvalid'), t('dateInvalid'))}
                onChange={(event) => {
                  patch({ openingDate: event.target.value });
                }}
              />
            </FormRow>
          </>
        )}

        {isBroker && (
          <>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1.5 p-0 text-sm font-medium text-fg-2">
                {t('subAccounts')}
              </legend>
              {form.subAccounts.map((sub, index) => (
                <div key={sub.id ?? index} className="grid grid-cols-[1fr_minmax(0,160px)] gap-2">
                  <input
                    aria-label={t('subAccountName')}
                    maxLength={60}
                    autoComplete="off"
                    className={`h-[34px] w-full rounded-sm border border-line-2 bg-inset px-2.5 text-base text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${invalidClass(!!errors.subAccounts) || ''}`}
                    value={sub.name}
                    onChange={(event) => {
                      patch({
                        subAccounts: form.subAccounts.map((one, at) =>
                          at === index ? { ...one, name: event.target.value } : one,
                        ),
                      });
                    }}
                  />
                  <Select
                    aria-label={t('subAccountHolder')}
                    value={sub.holderId}
                    onChange={(event) => {
                      patch({
                        subAccounts: form.subAccounts.map((one, at) =>
                          at === index ? { ...one, holderId: event.target.value } : one,
                        ),
                      });
                    }}
                  >
                    <option value="">{t('subAccountNoHolder')}</option>
                    {ownersOfAccount.map((holder) => (
                      <option key={holder.id} value={holder.id}>
                        {holder.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    patch({
                      subAccounts: [...form.subAccounts, { name: '', holderId: '' }],
                    });
                  }}
                >
                  <Plus aria-hidden />
                  {t('addSubAccount')}
                </Button>
              </div>
              <Hint error={!!errors.subAccounts}>
                {errors.subAccounts ? t('subAccountsDuplicate') : t('subAccountsHint')}
              </Hint>
            </fieldset>
            <TextField
              id={id('xtb')}
              label={t('xtbNumber')}
              hint={t('xtbHint')}
              maxLength={30}
              value={form.xtbAccountNo}
              onChange={(event) => {
                patch({ xtbAccountNo: event.target.value });
              }}
            />
            <label className="flex cursor-pointer items-start gap-3 text-md">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--accent)]"
                checked={form.trackCash}
                onChange={(event) => {
                  patch({ trackCash: event.target.checked });
                }}
              />
              {t('trackCash')}
            </label>
            <p className="m-0 rounded-md bg-inset p-3 text-sm text-fg-2">{t('trackCashNote')}</p>
          </>
        )}
      </form>
    </Modal>
  );
}

/** The product's terms copied into the deposit fields (what the mockup says choosing one does). */
function applyProduct(form: AccountForm, product: ProductDto): Partial<AccountForm> & AccountForm {
  return {
    ...form,
    productId: product.id,
    institution: product.institution ?? form.institution,
    rate: product.rate,
    payN: product.payN === null ? '' : String(product.payN),
    payU: product.payU ?? 'm',
    termN: product.termN === null ? '' : String(product.termN),
    termU: product.termU ?? 'm',
    tax: product.tax ?? form.tax,
    payToAccountId: product.payToAccountId ?? '',
    fundFromAccountId: product.fundFromAccountId ?? '',
  };
}

/**
 * Requests that bring the sub-accounts of an edited account to the form: removals first, then
 * renames, then additions (so a freed name can be reused).
 */
function subAccountSteps(accountPath: string, account: AccountCardDto, form: AccountForm) {
  const removals: (() => Promise<Response>)[] = [];
  const changes: (() => Promise<Response>)[] = [];
  const additions: (() => Promise<Response>)[] = [];
  const kept = new Set<string>();
  for (const sub of form.subAccounts) {
    const name = sub.name.trim();
    const holderId = sub.holderId === '' ? null : sub.holderId;
    if (sub.id === undefined) {
      if (name !== '') {
        additions.push(() => postJson(`${accountPath}/sub-accounts`, { name, holderId }));
      }
      continue;
    }
    if (name === '') continue;
    const subId = sub.id;
    kept.add(subId);
    const existing = account.subAccounts.find((one) => one.id === subId);
    if (existing && (existing.name !== name || existing.holderId !== holderId)) {
      changes.push(() =>
        sendJson('PATCH', `${accountPath}/sub-accounts/${encodeURIComponent(subId)}`, {
          name,
          holderId,
        }),
      );
    }
  }
  for (const sub of account.subAccounts) {
    if (!kept.has(sub.id)) {
      removals.push(() =>
        sendJson('DELETE', `${accountPath}/sub-accounts/${encodeURIComponent(sub.id)}`),
      );
    }
  }
  return [...removals, ...changes, ...additions];
}
