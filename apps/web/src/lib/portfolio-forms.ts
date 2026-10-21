import type { OpView } from './portfolios-types';

/** "1,5" and "1.5" are the same number for a pt-PT user; the API wants the dot. */
export function normalizeDecimal(text: string): string {
  return text.trim().replace(/\s/g, '').replace(',', '.');
}

/** An empty field is `null` (clears the value), anything else the normalised text. */
export function decimalOrNull(text: string): string | null {
  const value = normalizeDecimal(text);
  return value === '' ? null : value;
}

export type OpKind = 'buy' | 'sell' | 'dividend';

export interface OpForm {
  type: OpKind;
  portfolioId: string;
  assetId: string;
  date: string;
  accountId: string;
  subAccountId: string;
  qty: string;
  price: string;
  fee: string;
  amount: string;
  gross: string;
  tax: string;
  fromCash: boolean;
  note: string;
}

export function emptyOpForm(defaults: Partial<OpForm> & { date: string }): OpForm {
  return {
    type: 'buy',
    portfolioId: '',
    assetId: '',
    accountId: '',
    subAccountId: '',
    qty: '',
    price: '',
    fee: '',
    amount: '',
    gross: '',
    tax: '',
    fromCash: false,
    note: '',
    ...defaults,
  };
}

/** The form of an existing operation. */
export function opToForm(op: OpView): OpForm {
  return {
    type: op.type,
    portfolioId: op.portfolioId,
    assetId: op.assetId,
    date: op.date,
    accountId: op.accountId ?? '',
    subAccountId: op.subAccountId ?? '',
    qty: op.qty ?? '',
    price: op.price ?? '',
    fee: op.fee ?? '',
    amount: op.amount ?? '',
    gross: op.gross ?? '',
    tax: op.tax ?? '',
    fromCash: op.fromCash,
    note: op.note ?? '',
  };
}

/** The fields the form needs filled before it can be sent, for the chosen kind of operation. */
export function missingOpFields(form: OpForm): (keyof OpForm)[] {
  const required: (keyof OpForm)[] = ['portfolioId', 'assetId', 'date'];
  if (form.type === 'dividend') required.push('amount');
  else required.push('qty', 'price');
  return required.filter((field) => String(form[field]).trim() === '');
}

/**
 * The body of the request: only the fields of the chosen kind (a dividend has no quantity, a buy
 * no gross), and an empty optional field is sent as `null` so an edit clears it.
 */
export function opBody(form: OpForm) {
  const base = {
    portfolioId: form.portfolioId,
    assetId: form.assetId,
    type: form.type,
    date: form.date,
    accountId: form.accountId || null,
    subAccountId: form.accountId && form.subAccountId ? form.subAccountId : null,
    note: form.note.trim() === '' ? null : form.note.trim(),
  };
  if (form.type === 'dividend') {
    return {
      ...base,
      qty: null,
      price: null,
      fee: null,
      fromCash: false,
      amount: decimalOrNull(form.amount),
      gross: decimalOrNull(form.gross),
      tax: decimalOrNull(form.tax),
    };
  }
  return {
    ...base,
    qty: decimalOrNull(form.qty),
    price: decimalOrNull(form.price),
    fee: decimalOrNull(form.fee),
    fromCash: form.type === 'buy' && form.fromCash,
    amount: null,
    gross: null,
    tax: null,
  };
}

/** Targets as editable rows (label, percentage) and back; blank rows are dropped. */
export interface TargetRow {
  label: string;
  percent: string;
}

export function targetsToRows(targets: Readonly<Record<string, string>>): TargetRow[] {
  return Object.entries(targets).map(([label, percent]) => ({ label, percent }));
}

export function rowsToTargets(rows: readonly TargetRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .map((row) => [row.label.trim(), normalizeDecimal(row.percent)] as const)
      .filter(([label, percent]) => label !== '' && percent !== ''),
  );
}

/** The path of a pool's REST resource, with the ids encoded. */
export function poolApi(poolId: string, ...segments: string[]): string {
  return [`/api/v1/pools/${encodeURIComponent(poolId)}`, ...segments.map(encodeURIComponent)].join(
    '/',
  );
}
