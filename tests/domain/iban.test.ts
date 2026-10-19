import { describe, expect, it } from 'vitest';

import { isValidIban, normalizeIban } from '@nestvault/domain';

describe('normalizeIban', () => {
  it('drops spaces and dashes and upper-cases', () => {
    expect(normalizeIban(' pt50 0002 0123-1234 5678 9015 4 ')).toBe('PT50000201231234567890154');
  });
});

describe('isValidIban', () => {
  it.each([
    'PT50000201231234567890154', // the example of the Banco de Portugal
    'GB82 WEST 1234 5698 7654 32',
    'DE89370400440532013000',
    'ES9121000418450200051332',
    'pt50 0002 0123 1234 5678 9015 4',
  ])('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each([
    ['a wrong check digit', 'PT50000201231234567890155'],
    ['a swapped pair of digits', 'PT50000201231234567890514'],
    ['too short', 'PT50'],
    ['letters where the check digits go', 'PTXX000201231234567890154'],
    ['no country', '5000020123123456789015412'],
    ['a symbol inside', 'PT50000201231234567890!54'],
    ['an injection payload', "PT50' OR 1=1 --"],
    ['empty', ''],
  ])('rejects %s', (_name, iban) => {
    expect(isValidIban(iban)).toBe(false);
  });
});
