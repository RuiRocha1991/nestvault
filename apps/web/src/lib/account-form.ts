// The account, savings-product and interest forms: what the user types, how it is checked before
// the request (so the errors show inline) and the strict bodies that are sent. The server checks
// everything again; nothing here decides who may write.

export const ACCOUNT_TYPES = ['checking', 'savings', 'term_deposit', 'brokerage'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
export type PeriodUnit = 'm' | 'd';

export interface SubAccountForm {
  /** Present for an existing sub-account; a blank name then removes it. */
  id?: string;
  name: string;
  holderId: string;
}

export interface AccountForm {
  type: AccountType;
  name: string;
  institution: string;
  holderIds: string[];
  iban: string;
  currency: string;
  opening: string;
  openingDate: string;
  groupName: string;
  /** '' = not linked to a portfolio. */
  portfolioId: string;
  /** TANB of a savings account or of a term deposit, in percent. */
  rate: string;
  trackCash: boolean;
  xtbAccountNo: string;
  subAccounts: SubAccountForm[];
  // Term deposit
  productId: string;
  capital: string;
  start: string;
  payN: string;
  payU: PeriodUnit;
  termN: string;
  termU: PeriodUnit;
  tax: string;
  /** '' = the interest stays in the deposit (capitalizes). */
  payToAccountId: string;
  /** '' = not indicated. */
  fundFromAccountId: string;
}

export const emptyAccountForm = (type: AccountType = 'checking'): AccountForm => ({
  type,
  name: '',
  institution: '',
  holderIds: [],
  iban: '',
  currency: 'EUR',
  opening: '',
  openingDate: '',
  groupName: '',
  portfolioId: '',
  rate: '',
  trackCash: true,
  xtbAccountNo: '',
  subAccounts: [],
  productId: '',
  capital: '',
  start: '',
  payN: '',
  payU: 'm',
  termN: '',
  termU: 'm',
  tax: '28',
  payToAccountId: '',
  fundFromAccountId: '',
});

const DECIMAL = /^-?\d{1,14}([.,]\d{1,4})?$/;
const PERCENT = /^\d{1,3}([.,]\d{1,4})?$/;
const WHOLE = /^\d{1,4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "1 234,5" or "1234.5" → "1234.5"; null when it is not a decimal with up to 4 places. */
export function parseDecimal(text: string, pattern: RegExp = DECIMAL): string | null {
  const clean = text.replace(/\s/g, '');
  return pattern.test(clean) ? clean.replace(',', '.') : null;
}

/** A percentage between 0 and 100 (decimal comma accepted). */
export function parsePercent(text: string): string | null {
  const value = parseDecimal(text, PERCENT);
  return value !== null && Number(value) <= 100 ? value : null;
}

/** A positive whole number up to 3650 (periods are counted in months or days). */
export function parsePeriod(text: string): number | null {
  const clean = text.trim();
  if (!WHOLE.test(clean)) return null;
  const value = Number(clean);
  return value >= 1 && value <= 3650 ? value : null;
}

/** A field problem the form shows next to the field (the text is chosen by the component). */
export type FieldProblem = 'required' | 'invalid';
export type FormErrors<K extends string = string> = Partial<Record<K, FieldProblem>>;

export type AccountField =
  | 'name'
  | 'holderIds'
  | 'iban'
  | 'opening'
  | 'openingDate'
  | 'rate'
  | 'capital'
  | 'start'
  | 'pay'
  | 'term'
  | 'tax'
  | 'subAccounts';

/**
 * The inline errors of an account form. An empty IBAN is fine; a filled one is only checked by the
 * server (mod-97), which answers with the field name. Optional fields only complain when filled.
 */
export function validateAccount(form: AccountForm): FormErrors<AccountField> {
  const errors: FormErrors<AccountField> = {};
  const isTerm = form.type === 'term_deposit';
  if (form.name.trim() === '' && !isTerm) errors.name = 'required';
  if (form.holderIds.length === 0) errors.holderIds = 'required';
  if (form.opening.trim() !== '' && parseDecimal(form.opening) === null) errors.opening = 'invalid';
  if (form.openingDate !== '' && !ISO_DATE.test(form.openingDate)) errors.openingDate = 'invalid';
  if (form.type === 'savings' && form.rate.trim() !== '' && parsePercent(form.rate) === null) {
    errors.rate = 'invalid';
  }
  if (isTerm) {
    if (form.rate.trim() === '') errors.rate = 'required';
    else if (parsePercent(form.rate) === null) errors.rate = 'invalid';
    const capital = parseDecimal(form.capital);
    if (form.capital.trim() === '') errors.capital = 'required';
    else if (capital === null || Number(capital) <= 0) errors.capital = 'invalid';
    if (form.start === '') errors.start = 'required';
    else if (!ISO_DATE.test(form.start)) errors.start = 'invalid';
    if (form.payN.trim() !== '' && parsePeriod(form.payN) === null) errors.pay = 'invalid';
    if (form.termN.trim() !== '' && parsePeriod(form.termN) === null) errors.term = 'invalid';
    if (form.tax.trim() !== '' && parsePercent(form.tax) === null) errors.tax = 'invalid';
  }
  if (form.type === 'brokerage') {
    const names = form.subAccounts.map((sub) => sub.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) errors.subAccounts = 'invalid';
  }
  return errors;
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

/** The body of `POST`/`PATCH /accounts`: only client-editable fields. */
export function accountBody(form: AccountForm, mode: 'create' | 'update') {
  const isTerm = form.type === 'term_deposit';
  const isBroker = form.type === 'brokerage';
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    institution: orNull(form.institution),
    holderIds: form.holderIds,
    iban: isTerm ? null : orNull(form.iban),
    currency: isTerm ? 'EUR' : form.currency,
    opening: isTerm ? '0' : (parseDecimal(form.opening) ?? '0'),
    openingDate: isTerm ? null : orNull(form.openingDate),
    groupName: orNull(form.groupName),
    portfolioId: orNull(form.portfolioId),
    rate: form.type === 'savings' || isTerm ? (parsePercent(form.rate) ?? null) : null,
    trackCash: isBroker ? form.trackCash : true,
    xtbAccountNo: isBroker ? orNull(form.xtbAccountNo) : null,
  };
  if (mode === 'create') {
    body.type = form.type;
    if (isBroker) {
      const subs = form.subAccounts.filter((sub) => sub.name.trim() !== '');
      if (subs.length > 0) {
        body.subAccounts = subs.map((sub) => ({
          name: sub.name.trim(),
          holderId: sub.holderId === '' ? null : sub.holderId,
        }));
      }
    }
  }
  return body;
}

/** The deposit part of a term-deposit form; the pay-to account decides whether interest capitalizes. */
export function depositBody(form: AccountForm) {
  const payN = parsePeriod(form.payN);
  const termN = parsePeriod(form.termN);
  return {
    productId: orNull(form.productId),
    capital: parseDecimal(form.capital) ?? '0',
    start: form.start,
    rate: parsePercent(form.rate) ?? '0',
    payN,
    payU: payN === null ? null : form.payU,
    termN,
    termU: termN === null ? null : form.termU,
    capitalize: form.payToAccountId === '',
    tax: form.tax.trim() === '' ? null : parsePercent(form.tax),
    payToAccountId: orNull(form.payToAccountId),
    fundFromAccountId: orNull(form.fundFromAccountId),
  };
}

/** The name a deposit gets when the field is left blank: the product and the start date. */
export function defaultDepositName(productName: string | undefined, startLabel: string): string {
  return `${productName ?? ''}${productName && startLabel ? ' · ' : ''}${startLabel}`.trim();
}

/* ------------------------------------------------------------------ savings product */

export interface ProductForm {
  name: string;
  institution: string;
  rate: string;
  tax: string;
  payN: string;
  payU: PeriodUnit;
  termN: string;
  termU: PeriodUnit;
  payToAccountId: string;
  fundFromAccountId: string;
}

export const emptyProductForm = (): ProductForm => ({
  name: '',
  institution: '',
  rate: '',
  tax: '28',
  payN: '3',
  payU: 'm',
  termN: '12',
  termU: 'm',
  payToAccountId: '',
  fundFromAccountId: '',
});

export type ProductField = 'name' | 'rate' | 'tax' | 'pay' | 'term';

export function validateProduct(form: ProductForm): FormErrors<ProductField> {
  const errors: FormErrors<ProductField> = {};
  if (form.name.trim() === '') errors.name = 'required';
  if (form.rate.trim() === '') errors.rate = 'required';
  else if (parsePercent(form.rate) === null) errors.rate = 'invalid';
  if (form.tax.trim() !== '' && parsePercent(form.tax) === null) errors.tax = 'invalid';
  if (form.payN.trim() !== '' && parsePeriod(form.payN) === null) errors.pay = 'invalid';
  if (form.termN.trim() !== '' && parsePeriod(form.termN) === null) errors.term = 'invalid';
  return errors;
}

/** `0` or empty means "no period" in the form, as the mockup says ("0 ou vazio = só no fim"). */
const periodOrNull = (text: string): number | null => parsePeriod(text);

export function productBody(form: ProductForm) {
  const payN = periodOrNull(form.payN);
  const termN = periodOrNull(form.termN);
  return {
    name: form.name.trim(),
    institution: orNull(form.institution),
    rate: parsePercent(form.rate) ?? '0',
    tax: form.tax.trim() === '' ? null : parsePercent(form.tax),
    payN,
    payU: payN === null ? null : form.payU,
    termN,
    termU: termN === null ? null : form.termU,
    payToAccountId: orNull(form.payToAccountId),
    fundFromAccountId: orNull(form.fundFromAccountId),
  };
}

/* ------------------------------------------------------------------ interest entry */

export interface InterestForm {
  date: string;
  amount: string;
}

export type InterestField = 'date' | 'amount';

export function validateInterest(form: InterestForm): FormErrors<InterestField> {
  const errors: FormErrors<InterestField> = {};
  if (form.date === '') errors.date = 'required';
  else if (!ISO_DATE.test(form.date)) errors.date = 'invalid';
  const amount = parseDecimal(form.amount);
  if (form.amount.trim() === '') errors.amount = 'required';
  else if (amount === null || Number(amount) <= 0) errors.amount = 'invalid';
  return errors;
}

export const interestBody = (accountId: string, form: InterestForm) => ({
  accountId,
  date: form.date,
  amount: parseDecimal(form.amount) ?? '0',
});

/** Fields the server named in a 400, folded onto the form's own field names. */
export function serverFields(paths: readonly string[]): Set<string> {
  return new Set(paths.map((path) => path.split('.')[0] ?? path));
}
