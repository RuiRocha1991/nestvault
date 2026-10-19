/** Spaces and dashes out, upper case: how an IBAN is stored and compared. */
export const normalizeIban = (text: string): string => text.replace(/[\s-]+/g, '').toUpperCase();

/**
 * The ISO 13616 check: 2 letters, 2 digits, up to 30 letters or digits, and the mod-97 remainder of
 * the rearranged number equal to 1. It does not know each country's length, only the shared rule.
 */
export function isValidIban(text: string): boolean {
  const iban = normalizeIban(text);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    // Letters are 10..35: two digits each, so the remainder is carried one char at a time.
    const digits = String(parseInt(char, 36));
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
