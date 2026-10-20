import { describe, expect, it } from 'vitest';

import { hashText, normalizeText, parseDate, transactionHash } from '@nestvault/domain';

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

describe('transactionHash (NES-47)', () => {
  const line = {
    accountId: 'acc-1',
    date: '2026-01-15',
    description: 'Café  Pátio',
    amount: '-1.20',
  };

  it('hashes account + date + normalized description + plain amount + # occurrence with SHA-256', () => {
    expect(transactionHash(line, 1)).toBe(hashText('acc-12026-01-15CAFE PATIO-1.2#1'));
    expect(transactionHash(line, 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts identical lines apart and ignores how the amount was written', () => {
    expect(transactionHash(line, 2)).not.toBe(transactionHash(line, 1));
    expect(transactionHash({ ...line, amount: '-1.2000' }, 1)).toBe(transactionHash(line, 1));
    expect(transactionHash({ ...line, amount: '-45' }, 1)).toBe(
      transactionHash({ ...line, amount: '-45.00' }, 1),
    );
  });

  it('differs by account, date, description and sign', () => {
    const base = transactionHash(line, 1);
    expect(transactionHash({ ...line, accountId: 'acc-2' }, 1)).not.toBe(base);
    expect(transactionHash({ ...line, date: '2026-01-16' }, 1)).not.toBe(base);
    expect(transactionHash({ ...line, description: 'Café' }, 1)).not.toBe(base);
    expect(transactionHash({ ...line, amount: '1.20' }, 1)).not.toBe(base);
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
