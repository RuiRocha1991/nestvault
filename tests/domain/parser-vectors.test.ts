import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeText, parseDate, parseNum } from '@nestvault/domain';

// The same file is run by the parser service (services/parser/tests/test_helpers.py): both
// implementations must give the same answer for every vector (NES-56).
interface Vector {
  input: string | number | null;
  expected: string | null;
}
const vectors = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../services/parser/schemas/test-vectors.json'),
    'utf8',
  ),
) as { parseNum: Vector[]; parseDate: Vector[]; normalizeText: Vector[] };

describe('cross-language test vectors (shared with the Python parser service)', () => {
  it.each(vectors.parseNum)('parseNum($input) -> $expected', ({ input, expected }) => {
    expect(parseNum(input)).toBe(expected);
  });

  it.each(vectors.parseDate)('parseDate($input) -> $expected', ({ input, expected }) => {
    expect(parseDate(input)).toBe(expected);
  });

  it.each(vectors.normalizeText)('normalizeText($input) -> $expected', ({ input, expected }) => {
    expect(normalizeText(input as string | null)).toBe(expected);
  });

  it('covers every kind of input the helpers accept', () => {
    expect(vectors.parseNum.length).toBeGreaterThan(40);
    expect(vectors.parseDate.length).toBeGreaterThan(20);
    expect(vectors.parseNum.some((v) => typeof v.input === 'number')).toBe(true);
    expect(vectors.parseDate.some((v) => typeof v.input === 'number')).toBe(true);
  });
});
