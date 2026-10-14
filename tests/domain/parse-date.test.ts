import { describe, expect, it } from 'vitest';

import { hashText, normalizeText, parseDate } from '@nestvault/domain';

describe('parseDate', () => {
  it.each([
    ['2026-01-05', '2026-01-05'],
    ['2026-1-5', '2026-01-05'],
    ['2026/01/05', '2026-01-05'],
    ['2026.01.05', '2026-01-05'],
    ['2026-01-05T10:20:30Z', '2026-01-05'],
    ['05-01-2026', '2026-01-05'],
    ['05/01/2026', '2026-01-05'],
    ['5/1/2026', '2026-01-05'],
    ['05.01.2026', '2026-01-05'],
    ['05/01/26', '2026-01-05'],
    ['29/02/2024', '2024-02-29'],
    ['  05/01/2026  ', '2026-01-05'],
  ])('%j -> %j', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('reads Excel serial numbers', () => {
    expect(parseDate(45292)).toBe('2024-01-01');
    expect(parseDate(46027.75)).toBe('2026-01-05');
    expect(parseDate(25569)).toBe('1970-01-01');
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['hello'],
    ['31/02/2026'],
    ['2026-13-01'],
    ['29/02/2026'],
    ['05/01/20266'],
    ['2026-01-055'],
    [100],
    [90000],
    [Number.NaN],
  ])('garbage %j -> null', (input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe('normalizeText', () => {
  it('strips accents, upper-cases and collapses spaces', () => {
    expect(normalizeText('  Câmara   Municipal\tde Évora ')).toBe('CAMARA MUNICIPAL DE EVORA');
    expect(normalizeText('açúcar')).toBe('ACUCAR');
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('hashText', () => {
  it('is the SHA-256 hex digest', () => {
    expect(hashText('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is stable and sensitive to every character', () => {
    expect(hashText('a|2026-01-05|10')).toBe(hashText('a|2026-01-05|10'));
    expect(hashText('a|2026-01-05|10')).not.toBe(hashText('a|2026-01-05|11'));
  });
});
