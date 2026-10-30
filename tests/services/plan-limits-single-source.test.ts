import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_FEATURES, PLAN_LIMITS } from '@nestvault/services';

const SERVICES_SRC = join(__dirname, '../../packages/services/src');
const PLANS_FILE = join(SERVICES_SRC, 'entitlements/plans.ts');
// Size caps of the prototype export file (how many rows one import accepts): not plan limits.
const NOT_PLAN_LIMITS = [join(SERVICES_SRC, 'prototype-import/schema.ts')];

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesIn(path);
    return path.endsWith('.ts') ? [path] : [];
  });

describe('plan numbers live in plans.ts only', () => {
  it('holds the numbers of ADR 0003', () => {
    expect(PLAN_LIMITS.free).toEqual({ accounts: 3, portfolios: 2, members: 1 });
    expect(PLAN_LIMITS.pro).toEqual({ accounts: null, portfolios: null, members: null });
    expect(PLAN_FEATURES.free).toEqual({ real_estate: false, ai_import: false });
    expect(PLAN_FEATURES.pro).toEqual({ real_estate: true, ai_import: true });
  });

  it('has no limit written anywhere else in the services', () => {
    // `accounts: 3`, `portfolios <= 2`, `members >= 1`... next to a plan resource name.
    const limitLike = /\b(accounts|portfolios|members)\b\s*(:|<=?|>=?|===?)\s*\d/;
    const offenders = sourcesIn(SERVICES_SRC)
      .filter((file) => file !== PLANS_FILE && !NOT_PLAN_LIMITS.includes(file))
      .filter((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .some((line) => !line.trimStart().startsWith('//') && limitLike.test(line)),
      )
      .map((file) => relative(SERVICES_SRC, file));
    expect(offenders).toEqual([]);
  });
});
