// pt-PT formatting helpers. Money arrives as a decimal string (numeric(18,4) from the database)
// and is rounded with integer arithmetic, so no float ever touches the value.

const NBSP = ' ';

export type DecimalInput = string | number;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function toDecimalString(value: DecimalInput): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Cannot format a non-finite number');
    return value.toFixed(8);
  }
  return value.trim();
}

/** Rounds a decimal string half away from zero to `digits` fraction digits. */
function roundDecimal(
  value: DecimalInput,
  digits: number,
): { negative: boolean; int: string; frac: string } {
  const match = DECIMAL.exec(toDecimalString(value));
  if (!match) throw new RangeError('Not a decimal number');
  const sign = match[1] ?? '';
  const intPart = match[2] ?? '0';
  const fracPart = match[3] ?? '';
  const scaled = BigInt(intPart + fracPart.padEnd(digits + 1, '0').slice(0, digits));
  const roundUp = (fracPart.padEnd(digits + 1, '0')[digits] ?? '0') >= '5';
  const rounded = roundUp ? scaled + 1n : scaled;
  const text = rounded.toString().padStart(digits + 1, '0');
  const int = digits === 0 ? text : text.slice(0, -digits);
  const frac = digits === 0 ? '' : text.slice(-digits);
  const negative = sign === '-' && rounded !== 0n;
  return { negative, int, frac };
}

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

function currencySymbol(currency: string): string {
  const parts = new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

/** `formatNumber('16.3')` → `16,30`: a decimal with grouped thousands and no currency (prices). */
export function formatNumber(value: DecimalInput, digits = 2): string {
  const { negative, int, frac } = roundDecimal(value, digits);
  return `${negative ? '-' : ''}${groupThousands(int)}${digits > 0 ? `,${frac}` : ''}`;
}

export interface FormatMoneyOptions {
  /** Fraction digits, default 2 (0 for the big totals of the overview). */
  digits?: number;
}

/** `formatMoney('1234.56', 'EUR')` → `1 234,56 €` (non-breaking spaces); `USD` → `US$`. */
export function formatMoney(
  value: DecimalInput,
  currency = 'EUR',
  options: FormatMoneyOptions = {},
): string {
  const digits = options.digits ?? 2;
  const { negative, int, frac } = roundDecimal(value, digits);
  const sign = negative ? '-' : '';
  const fraction = digits > 0 ? `,${frac}` : '';
  return `${sign}${groupThousands(int)}${fraction}${NBSP}${currencySymbol(currency)}`;
}

/** `formatDate('2026-10-11')` → `11/10/2026`. A `Date` is read in UTC (database dates are UTC). */
export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('Invalid date');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${String(value.getUTCFullYear()).padStart(4, '0')}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) throw new RangeError('Expected an ISO date (yyyy-mm-dd)');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export interface FormatPctOptions {
  /** Fraction digits, default 1. */
  digits?: number;
  /** Prefix positive values with `+`. */
  signed?: boolean;
}

/** `formatPct(7.3, { signed: true })` → `+7,3%`. The input is already a percentage. */
export function formatPct(value: DecimalInput, options: FormatPctOptions = {}): string {
  const { digits = 1, signed = false } = options;
  const { negative, int, frac } = roundDecimal(value, digits);
  const isZero = !negative && /^0*$/.test(int + frac);
  const sign = negative ? '-' : signed && !isZero ? '+' : '';
  return `${sign}${groupThousands(int)}${digits > 0 ? `,${frac}` : ''}%`;
}
