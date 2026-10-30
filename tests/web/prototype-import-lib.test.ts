import { describe, expect, it } from 'vitest';

import { WARNING_CODES } from '@nestvault/services';

import messages from '../../apps/web/messages/pt-PT.json';
import {
  COUNT_KEYS,
  MAX_IMPORT_BYTES,
  problemOf,
  readAnswer,
  visibleCounts,
  warningKey,
} from '../../apps/web/src/lib/prototype-import';

describe('import card helpers (NES-47)', () => {
  it('has the same file limit as the endpoint', () => {
    expect(MAX_IMPORT_BYTES).toBe(10 * 1024 * 1024);
  });

  it('maps a failed answer to the message that explains it', () => {
    expect([400, 403, 409, 413, 429, 500, 0].map(problemOf)).toEqual([
      'invalid',
      'forbidden',
      'notEmpty',
      'tooLarge',
      'limit',
      'error',
      'error',
    ]);
  });

  it('reads a good answer and rejects anything else', () => {
    const good = {
      dryRun: true,
      counts: { accounts: 2 },
      warnings: [{ code: 'op_skipped', count: 1 }],
    };
    expect(readAnswer(good)).toEqual(good);
    for (const bad of [
      null,
      'x',
      {},
      { dryRun: 'yes', counts: {}, warnings: [] },
      { dryRun: true, counts: {} },
    ]) {
      expect(readAnswer(bad)).toBeNull();
    }
  });

  it('lists only the counts above zero, in display order', () => {
    expect(visibleCounts({ transactions: 3, accounts: 2, rules: 0, unknown: 9 })).toEqual([
      { key: 'accounts', value: 2 },
      { key: 'transactions', value: 3 },
    ]);
  });

  it('turns a warning code into a camelCase message key', () => {
    expect(warningKey('goal_scope_dropped')).toBe('goalScopeDropped');
    expect(warningKey('pair_dropped')).toBe('pairDropped');
  });

  it('has a Portuguese message for every count, warning and problem', () => {
    const card = messages.importPrototype;
    for (const key of COUNT_KEYS) expect(card.counts, key).toHaveProperty(key);
    for (const code of WARNING_CODES) expect(card.warnings, code).toHaveProperty(warningKey(code));
    for (const problem of [
      'notJson',
      'tooLarge',
      'invalid',
      'forbidden',
      'notEmpty',
      'limit',
      'error',
    ]) {
      expect(card.problem, problem).toHaveProperty(problem);
    }
  });
});
