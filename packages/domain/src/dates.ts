/**
 * Dates are ISO strings `yyyy-mm-dd` and months are `yyyy-mm` keys. Everything is computed in UTC
 * from the calendar parts, so the result never depends on the machine's time zone or DST.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

function utc(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True for a real calendar date written `yyyy-mm-dd` (no 31 February). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utc(year, month, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parts(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match || !isIsoDate(date)) throw new RangeError(`Not an ISO date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function monthParts(key: string): [number, number] {
  const match = MONTH_KEY.exec(key);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) throw new RangeError(`Not a month key: ${key}`);
  return [Number(match[1]), month];
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return toIso(new Date(utc(year, month, day).getTime() + days * DAY_MS));
}

/** Clamps to the end of the month: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const last = utc(targetYear, targetMonth + 1, 0).getUTCDate();
  return toIso(utc(targetYear, targetMonth, Math.min(day, last)));
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((utc(y2, m2, d2).getTime() - utc(y1, m1, d1).getTime()) / DAY_MS);
}

/** `yyyy-mm` of a date. */
export function monthKey(date: string): string {
  parts(date); // validates
  return date.slice(0, 7);
}

/** Calendar months from one date (or month key) to another; days are ignored. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = monthParts(from.slice(0, 7));
  const [y2, m2] = monthParts(to.slice(0, 7));
  return (y2 - y1) * 12 + (m2 - m1);
}

/** Last day of a `yyyy-mm` month. */
export function monthEnd(key: string): string {
  const [year, month] = monthParts(key);
  return toIso(utc(year, month + 1, 0));
}

/** The `n` month keys ending with the month of `asOf`, oldest first. */
export function lastMonths(n: number, asOf: string): string[] {
  const first = `${monthKey(asOf)}-01`;
  return Array.from({ length: n }, (_, i) => monthKey(addMonths(first, i - n + 1)));
}

/** The `n` month keys starting with the month of `asOf`, soonest first. */
export function nextMonths(n: number, asOf: string): string[] {
  const first = `${monthKey(asOf)}-01`;
  return Array.from({ length: n }, (_, i) => monthKey(addMonths(first, i)));
}
