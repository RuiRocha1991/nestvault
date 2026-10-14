import { dec, toPlain } from './decimal';

const STRIP = /\s|€|EUR/gi;
const PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)$/;
const DOTTED_GROUPS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Parses a number as written in statements and spreadsheets and returns a plain decimal string, or
 * null when it is not a number. Handles `1.234,56`, `1,234.56`, `(12,00)`, `12,00-`, `€`, `EUR`
 * and spaces (NBSP included). With both separators the last one is the decimal point; a lone comma
 * is a decimal comma unless repeated; a lone dot is a thousands separator only in groups of three.
 */
export function parseNum(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? toPlain(value) : null;

  let text = value.replace(STRIP, '');
  if (text === '') return null;

  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    if (negative) return null;
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    text =
      lastComma > lastDot ? text.replaceAll('.', '').replace(',', '.') : text.replaceAll(',', '');
  } else if (lastComma > -1) {
    text = lastComma === text.indexOf(',') ? text.replace(',', '.') : text.replaceAll(',', '');
  } else if (lastDot > -1 && DOTTED_GROUPS.test(text)) {
    text = text.replaceAll('.', '');
  }

  if (!PLAIN_NUMBER.test(text)) return null;
  const result = toPlain(dec(text));
  return negative && result !== '0' ? `-${result}` : result;
}
