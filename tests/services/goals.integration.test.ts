import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ForbiddenError,
  GoalDto,
  GoalListDto,
  logger,
  NotFoundError,
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

const goal = async (as: Persona, body: unknown = {}, poolId = s.poolA) =>
  world.goals.create(await s.as(as), poolId, {
    name: 'Independência financeira',
    color: '#9D6BFF',
    type: 'value',
    target: '500000',
    deadline: '2060-01-01',
    monthly: '500',
    rate: '6',
    ...(body as object),
  });
const ownerOf = (poolId: string): Persona => (poolId === s.poolA ? 'owner' : 'outsider');
const holder = async (poolId = s.poolA) =>
  (await world.holders.list(await s.as(ownerOf(poolId)), poolId)).holders[0]?.id ?? '';
const account = async (name: string, extra: object = {}, poolId = s.poolA) =>
  world.accounts.create(await s.as(ownerOf(poolId)), poolId, {
    type: 'checking',
    name,
    currency: 'EUR',
    opening: '1000',
    holderIds: [await holder(poolId)],
    ...extra,
  });
const portfolio = async (name = 'Reforma', poolId = s.poolA) =>
  world.portfolios.create(await s.as(ownerOf(poolId)), poolId, {
    name,
    color: '#112233',
    currency: 'EUR',
  });

describe('goals service', () => {
  it('lets owner and admin write; refuses member and viewer (403); everybody reads', async () => {
    for (const as of ['owner', 'admin'] as const) {
      const created = await goal(as);
      expect(GoalDto.parse(created)).toEqual(created);
    }
    for (const as of ['member', 'viewer'] as const) {
      await expect(goal(as)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const list = await world.goals.list(await s.as('viewer'), s.poolA);
    expect(GoalListDto.parse(list)).toEqual(list);
    expect(list.goals).toHaveLength(2);

    const [first] = list.goals;
    for (const as of ['member', 'viewer'] as const) {
      await expect(
        world.goals.update(await s.as(as), s.poolA, first?.id ?? '', { name: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.goals.remove(await s.as(as), s.poolA, first?.id ?? ''),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await world.goals.remove(await s.as('admin'), s.poolA, first?.id ?? '');
    expect((await world.goals.list(await s.as('owner'), s.poolA)).goals).toHaveLength(1);
  });

  it('calculates the goal from the pool data', async () => {
    await account('Conta', { opening: '1000' });
    const created = await goal('owner', { target: '10000', rate: '0', monthly: '100' });
    expect(created.result.mode).toBe('date');
    expect(created.result.status).toBeTruthy();
    expect(created.result.target).toBe('10000');
    // The goal counts investments only (no savings yet): a checking account is not counted.
    expect(created.result.progress).toBe('0');
    expect(created.type).toBe('value');
  });

  it('counts only the sub-account in scope', async () => {
    const acc = await account('Corretora', { type: 'brokerage', opening: '0' });
    const created = await goal('owner', {
      accounts: [{ accountId: acc.id }],
      type: 'invested',
      target: '1000',
      mode: 'eta',
      deadline: null,
    });
    expect(created.accounts).toEqual([{ accountId: acc.id, subAccountId: null }]);
    expect(created.result.scopeNames).toHaveLength(1);
  });

  it('keeps the scopes when a patch leaves them out and replaces them when given', async () => {
    const p = await portfolio();
    const created = await goal('owner', { portfolioIds: [p.id] });
    expect(created.portfolioIds).toEqual([p.id]);
    const renamed = await world.goals.update(await s.as('owner'), s.poolA, created.id, {
      name: 'Outro nome',
    });
    expect(renamed).toMatchObject({ name: 'Outro nome', portfolioIds: [p.id] });
    const cleared = await world.goals.update(await s.as('owner'), s.poolA, created.id, {
      portfolioIds: [],
    });
    expect(cleared.portfolioIds).toEqual([]);
  });

  it('forces a date for a contrib goal and refuses a missing deadline', async () => {
    const contrib = await goal('owner', {
      type: 'contrib',
      mode: 'none',
      target: '6000',
      deadline: '2030-12-31',
    });
    expect(contrib.mode).toBe('date');
    await expect(goal('owner', { deadline: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      goal('owner', { type: 'contrib', mode: 'eta', deadline: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Other modes do not need a date.
    const eta = await goal('owner', { mode: 'eta', deadline: null });
    expect(eta.deadline).toBeNull();
  });

  it('answers 400 for bad or extra fields', async () => {
    for (const bad of [
      { poolId: s.poolB },
      { id: '0192f3a1-0000-7000-8000-000000000001' },
      { color: 'red' },
      { type: 'wealth' },
      { mode: 'later' },
      { name: '' },
      { target: '0' },
      { target: '-5' },
      { target: '1e9' },
      { rate: '101' },
      { monthly: '-1' },
      { portfolioIds: ['not-a-uuid'] },
      { accounts: [{ accountId: 'x' }] },
    ]) {
      await expect(goal('owner', bad)).rejects.toBeInstanceOf(ValidationError);
    }
    const created = await goal('owner');
    await expect(
      world.goals.update(await s.as('owner'), s.poolA, created.id, { poolId: s.poolB }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores an injection payload as plain text', async () => {
    for (const name of ["' OR 1=1 --", "'; DROP TABLE goals; --"]) {
      const created = await goal('owner', { name });
      expect(created.name).toBe(name);
    }
    expect((await world.goals.list(await s.as('owner'), s.poolA)).goals).toHaveLength(2);
  });

  it('hides the pool from a non-member and refuses a request without a session', async () => {
    const mine = await goal('owner');
    await expect(world.goals.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.goals.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.goals.get(await s.as('outsider'), s.poolB, mine.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.goals.update(await s.as('outsider'), s.poolB, mine.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.goals.remove(await s.as('outsider'), s.poolB, mine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.goals.get(await s.as('owner'), s.poolA, 'not-an-id')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses a portfolio or an account of another pool', async () => {
    const foreignPortfolio = await portfolio('Alheia', s.poolB);
    await expect(goal('owner', { portfolioIds: [foreignPortfolio.id] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const foreignAccount = await account('Alheia', {}, s.poolB);
    await expect(
      goal('owner', { accounts: [{ accountId: foreignAccount.id }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await world.goals.list(await s.as('owner'), s.poolA)).goals).toEqual([]);
  });

  it('never shows or changes another pool’s goals', async () => {
    await goal('outsider', { name: 'Da pool B' }, s.poolB);
    expect((await world.goals.list(await s.as('owner'), s.poolA)).goals).toEqual([]);
  });

  it('records the changes in the audit log without amounts', async () => {
    const created = await goal('owner', { target: '123456' });
    await world.goals.update(await s.as('owner'), s.poolA, created.id, { name: 'Novo' });
    await world.goals.remove(await s.as('owner'), s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'goal.%' and target = ${created.id} order by at`,
    );
    expect(log.map((row) => row.action)).toEqual(['goal.created', 'goal.updated', 'goal.deleted']);
    expect(JSON.stringify(log)).not.toContain('123456');
  });
});
