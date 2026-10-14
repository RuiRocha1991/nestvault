import { addDays, isIsoDate } from './dates';

const YEAR_FIRST = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const DAY_FIRST = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;
const EXCEL_EPOCH = '1899-12-30';

function build(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Reads a date from `yyyy-mm-dd`, `dd-mm-yyyy` or `dd/mm/yyyy` (also `.`; a trailing time is
 * ignored; a two-digit year means 20yy) or an Excel serial number. Returns an ISO date, or null for
 * anything else, including dates that do not exist.
 */
export function parseDate(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') {
    return value > 20000 && value < 80000 ? addDays(EXCEL_EPOCH, Math.floor(value)) : null;
  }
  const text = (value ?? '').trim();
  const first = YEAR_FIRST.exec(text);
  if (first) return build(first[1] ?? '', first[2] ?? '', first[3] ?? '');
  const second = DAY_FIRST.exec(text);
  if (second) {
    const year = second[3] ?? '';
    return build(year.length === 2 ? `20${year}` : year, second[2] ?? '', second[1] ?? '');
  }
  return null;
}
