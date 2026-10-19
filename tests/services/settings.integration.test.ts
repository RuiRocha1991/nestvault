import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ForbiddenError,
  FxDto,
  logger,
  NotFoundError,
  SettingsDto,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const get = async (as: Persona, poolId = s.poolA) => world.settings.get(await s.as(as), poolId);
const update = async (as: Persona, input: unknown, poolId = s.poolA) =>
  world.settings.update(await s.as(as), poolId, input);
const fx = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  world.settings.fx(await s.as(as), poolId, query);

describe('settings service: reading', () => {
  it('gives the defaults while the pool never saved anything, to every role', async () => {
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      const settings = await get(persona);
      expect(SettingsDto.parse(settings)).toEqual({
        transferWindowDays: 3,
        depositTax: '28',
        dividendTax: '28',
        displayCurrency: 'EUR',
        fxOverrides: {},
      });
    }
  });

  it('refuses a request without a session and hides the pool from a non-member', async () => {
    await expect(world.settings.get(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(get('outsider')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('settings service: updating', () => {
  it('lets owner and admin change some fields and keeps the others', async () => {
    const first = await update('owner', { depositTax: '25.5', transferWindowDays: 5 });
    expect(first).toMatchObject({ depositTax: '25.5', dividendTax: '28', transferWindowDays: 5 });
    const second = await update('admin', { dividendTax: '20' });
    expect(second).toMatchObject({ depositTax: '25.5', dividendTax: '20', transferWindowDays: 5 });
    expect(await get('viewer')).toEqual(second);
  });

  it('replaces the whole override map and clears it with an empty object', async () => {
    await update('owner', { fxOverrides: { USD: '0.9', GBP: '1.2' } });
    expect((await get('member')).fxOverrides).toEqual({ USD: '0.9', GBP: '1.2' });
    expect((await update('owner', { fxOverrides: { CHF: '1.1' } })).fxOverrides).toEqual({
      CHF: '1.1',
    });
    expect((await update('owner', { fxOverrides: {} })).fxOverrides).toEqual({});
  });

  it('refuses member and viewer with 403 and changes nothing', async () => {
    for (const persona of ['member', 'viewer'] as const) {
      await expect(update(persona, { depositTax: '10' })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await get('owner')).depositTax).toBe('28');
  });

  it('hides the pool from a non-member and never touches the other pool', async () => {
    await expect(update('outsider', { depositTax: '10' })).rejects.toBeInstanceOf(NotFoundError);
    await update('outsider', { depositTax: '12' }, s.poolB);
    expect((await get('owner')).depositTax).toBe('28');
    expect((await get('outsider', s.poolB)).depositTax).toBe('12');
  });

  it.each([
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['a field that is not an editable one', { updatedBy: 'x' }],
    ['a tax above 100', { depositTax: '100.01' }],
    ['a negative tax', { depositTax: '-1' }],
    ['a tax that is not a decimal string', { depositTax: 28 }],
    ['a window of 31 days', { transferWindowDays: 31 }],
    ['a fractional window', { transferWindowDays: 2.5 }],
    ['a rate for EUR', { fxOverrides: { EUR: '1' } }],
    ['a rate of zero', { fxOverrides: { USD: '0' } }],
    [
      'a rate that is not a decimal',
      { fxOverrides: { USD: "0.9'; DROP TABLE pool_settings; --" } },
    ],
    ['a currency that is not three capitals', { displayCurrency: 'eur' }],
    ['more than 20 overrides', { fxOverrides: manyOverrides() }],
  ])('rejects %s with 400', async (_name, input) => {
    await expect(update('owner', input)).rejects.toBeInstanceOf(ValidationError);
    expect((await get('owner')).depositTax).toBe('28');
  });

  it('writes one audit entry that names no value', async () => {
    await update('owner', { depositTax: '25', fxOverrides: { USD: '0.8765' } });
    const entries = await rows<{ action: string; target: string; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where action = 'settings.updated' and target = ${s.poolA}`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ target: s.poolA, meta: { count: 2 } });
    expect(JSON.stringify(entries[0])).not.toContain('0.8765');
  });
});

describe('settings service: fx rates', () => {
  it('gives the seeded market rates to every role', async () => {
    const result = FxDto.parse(await fx('viewer', { asOf: '2026-06-01' }));
    expect(result.asOf).toBe('2026-06-01');
    expect(result.rates).toEqual([
      { currency: 'CHF', rate: '1.06', marketRate: '1.06', source: 'seed', date: '2026-01-01' },
      { currency: 'GBP', rate: '1.17', marketRate: '1.17', source: 'seed', date: '2026-01-01' },
      { currency: 'USD', rate: '0.92', marketRate: '0.92', source: 'seed', date: '2026-01-01' },
    ]);
  });

  it('puts the pool override first, only in that pool', async () => {
    await update('owner', { fxOverrides: { USD: '0.8' } });
    const mine = (await fx('member', { asOf: '2026-06-01' })).rates.find(
      (rate) => rate.currency === 'USD',
    );
    expect(mine).toMatchObject({ rate: '0.8', marketRate: '0.92', source: 'pool' });
    const other = (await fx('outsider', { asOf: '2026-06-01' }, s.poolB)).rates.find(
      (rate) => rate.currency === 'USD',
    );
    expect(other).toMatchObject({ rate: '0.92', source: 'seed' });
  });

  it('falls back to the default constants before the first market rate', async () => {
    const early = await fx('owner', { asOf: '2025-01-01' });
    expect(early.rates.map((rate) => [rate.currency, rate.rate, rate.source])).toEqual([
      ['CHF', '1.06', 'default'],
      ['GBP', '1.17', 'default'],
      ['USD', '0.92', 'default'],
    ]);
  });

  it('uses today when no day is given, and rejects a bad day or an extra parameter', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await fx('owner')).asOf).toBe(today);
    await expect(fx('owner', { asOf: '2026-13-45' })).rejects.toBeInstanceOf(ValidationError);
    await expect(fx('owner', { asOf: "2026-01-01' OR 1=1 --" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(fx('owner', { poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
  });

  it('hides the pool from a non-member and refuses a request without a session', async () => {
    await expect(fx('outsider')).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.settings.fx(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

function manyOverrides(): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: 21 }, (_, i) => [`A${String.fromCharCode(65 + i)}Z`, '1.5']),
  );
}
