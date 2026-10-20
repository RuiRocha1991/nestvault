import { dec, roundTo, toPlain, type Dec } from '@nestvault/domain';

import type { ValidationIssue } from '../errors';

import type { WarningCode } from './schema';

// Small, pure conversions from what the prototype stored (JS numbers, free text, empty strings for
// "none") to what the new schema stores (decimal strings, bounded text, null). Nothing here throws:
// a value that does not fit comes back as `null`/empty and the caller decides to skip or default.

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line of text: control characters (a NUL would break the insert) become spaces. */
export function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, max).join('');
}

/** Text that may span lines (a note): only the other control characters go. */
export function multiLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(CONTROL_KEEP_LINES, '').trim()).slice(0, max).join('');
}

/**
 * A number the prototype stored as a JS number or as typed text, rounded half-up to `places`.
 * `null` when it is not a finite number or does not fit `intDigits` integer digits.
 */
export function decimal(value: unknown, places: number, intDigits: number): string | null {
  let parsed: Dec;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    parsed = dec(value);
  } else if (typeof value === 'string') {
    const text = value.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
    parsed = dec(text);
  } else {
    return null;
  }
  const rounded = roundTo(parsed, places);
  if (rounded.abs().gte(dec(10).pow(intDigits))) return null;
  return toPlain(rounded);
}

/** Money: numeric(18,4). */
export const money = (value: unknown) => decimal(value, 4, 14);
/** Quantity: numeric(20,8). */
export const quantity = (value: unknown) => decimal(value, 8, 12);
/** Unit price: numeric(18,6). */
export const unitPrice = (value: unknown) => decimal(value, 6, 12);
/** A percentage from 0 to 100 with up to 4 decimals. */
export function percent(value: unknown): string | null {
  const text = decimal(value, 4, 3);
  return text !== null && !dec(text).isNeg() && dec(text).lte(100) ? text : null;
}

/** A whole number, or `null`. */
export function whole(value: unknown): number | null {
  const text = decimal(value, 0, 9);
  return text === null ? null : Number(text);
}

/** `yyyy-mm-dd` that is a real calendar day, or `null`. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value < '1000-01-01' || value > '9999-12-31') return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : value;
}

/** `#rrggbb` or `null`. */
export function hexColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

/** Collects warnings (by code, with how many times) and the problems that stop the import. */
export class Findings {
  readonly warnings = new Map<WarningCode, number>();
  readonly issues: ValidationIssue[] = [];

  warn(code: WarningCode, times = 1): void {
    this.warnings.set(code, (this.warnings.get(code) ?? 0) + times);
  }

  issue(path: string, message: string): void {
    if (this.issues.length < 50) this.issues.push({ path, message });
  }
}

/** The first free variant of a name: `Name`, `Name (2)`, `Name (3)`… compared without case. */
export function uniqueName(name: string, taken: Set<string>, max: number): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    candidate = `${Array.from(name)
      .slice(0, max - suffix.length)
      .join('')}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
