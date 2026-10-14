import { describe, expect, it } from 'vitest';

import { parseNum } from '@nestvault/domain';

describe('parseNum', () => {
  it.each([
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1.234.567,89', '1234567.89'],
    ['1,234,567.89', '1234567.89'],
    ['12,5', '12.5'],
    ['12.5', '12.5'],
    ['1.234', '1234'],
    ['1.234.567', '1234567'],
    ['1,234,567', '1234567'],
    ['12.3456', '12.3456'],
    ['0,5', '0.5'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['(12,00)', '-12'],
    ['12,00-', '-12'],
    ['-12,00', '-12'],
    ['+12,00', '12'],
    ['€ 1.234,56', '1234.56'],
    ['1234,56 EUR', '1234.56'],
    ['1 234,56 €', '1234.56'],
    ['1 234,56', '1234.56'],
    ['  42  ', '42'],
    ['0', '0'],
    ['-0', '0'],
    ['(0,00)', '0'],
    ['007', '7'],
  ])('%j -> %j', (input, expected) => {
    expect(parseNum(input)).toBe(expected);
  });

  it('accepts finite numbers and keeps them exact', () => {
    expect(parseNum(12.5)).toBe('12.5');
    expect(parseNum(-3)).toBe('-3');
    expect(parseNum(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(parseNum(1e-7)).toBe('0.0000001');
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['€'],
    ['abc'],
    ['12abc'],
    ['1.2.3'],
    ['1,2.3,4'],
    ['--5'],
    ['-(5)'],
    ['(5)-'],
    ['-'],
    ['()'],
    ['1e5'],
    ['0x10'],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])('garbage %j -> null', (input) => {
    expect(parseNum(input)).toBeNull();
  });
});
