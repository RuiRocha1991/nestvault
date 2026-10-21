import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountsScreenDto,
  logger,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Scenario } from '../support/api-world';

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

async function holderOf(poolId: string, persona: 'owner' | 'outsider') {
  const { holders } = await world.holders.list(await s.as(persona), poolId);
  return holders[0]?.id ?? '';
}

describe('accounts screen service', () => {
  it('returns every card with its balance to every member of the pool', async () => {
    const holder = await holderOf(s.poolA, 'owner');
    await world.accounts.create(await s.as('owner'), s.poolA, {
      type: 'savings',
      name: 'Conta remunerada',
      currency: 'EUR',
      opening: '1000',
      holderIds: [holder],
    });
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      const screen = await world.accounts.screen(await s.as(persona), s.poolA);
      expect(AccountsScreenDto.parse(screen)).toEqual(screen);
      expect(screen.accounts.map((card) => card.name)).toEqual(['Conta remunerada']);
      expect(screen.accounts[0]).toMatchObject({ balance: '1000', balanceEur: '1000' });
      expect(screen.totalsEur.savings).toBe('1000');
    }
  });

  it('answers 404 to a non-member and 401 without a session', async () => {
    await expect(world.accounts.screen(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.accounts.screen(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('never shows the accounts of another pool', async () => {
    await world.accounts.create(await s.as('owner'), s.poolA, {
      type: 'checking',
      name: 'Só do A',
      currency: 'EUR',
      holderIds: [await holderOf(s.poolA, 'owner')],
    });
    await world.accounts.create(await s.as('outsider'), s.poolB, {
      type: 'checking',
      name: 'Só do B',
      currency: 'EUR',
      holderIds: [await holderOf(s.poolB, 'outsider')],
    });
    const a = await world.accounts.screen(await s.as('owner'), s.poolA);
    const b = await world.accounts.screen(await s.as('outsider'), s.poolB);
    expect(a.accounts.map((card) => card.name)).toEqual(['Só do A']);
    expect(b.accounts.map((card) => card.name)).toEqual(['Só do B']);
  });

  it('names the failed field in a 400 so a form can mark it, without echoing the value', async () => {
    const holder = await holderOf(s.poolA, 'owner');
    const error = await world.accounts
      .create(await s.as('owner'), s.poolA, {
        type: 'checking',
        name: 'Conta',
        currency: 'EUR',
        iban: 'PT50 1234',
        holderIds: [holder],
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const issues = (error as ValidationError).issues;
    expect(issues.map((issue) => issue.path)).toEqual(['iban']);
    expect(JSON.stringify(issues)).not.toContain('1234');
  });
});
