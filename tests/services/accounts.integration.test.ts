import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountDto,
  ConflictError,
  ForbiddenError,
  logger,
  NotFoundError,
  SubAccountDto,
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

const IBAN = 'PT50000201231234567890154';
const SPACED = 'pt50 0002 0123 1234 5678 9015 4';

/** People of a pool by name: the members' own holders exist without anybody adding them. */
async function people(poolId = s.poolA, as: Persona = 'owner') {
  const { holders } = await world.holders.list(await s.as(as), poolId);
  return Object.fromEntries(holders.map((holder) => [holder.name, holder.id])) as Record<
    string,
    string
  >;
}

const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.accounts.create(await s.as(as), poolId, body);
const list = async (as: Persona, poolId = s.poolA) =>
  (await world.accounts.list(await s.as(as), poolId)).accounts;
const update = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.accounts.update(await s.as(as), poolId, id, body);

const checking = async (extra: Record<string, unknown> = {}) => {
  const who = await people();
  return create('owner', {
    type: 'checking',
    name: 'BPI',
    currency: 'EUR',
    holderIds: [who.owner],
    ...extra,
  });
};

describe('accounts service: reading', () => {
  it('lists the accounts to every member, with the balance and its EUR value', async () => {
    const who = await people();
    await create('owner', {
      type: 'checking',
      name: 'BPI',
      currency: 'EUR',
      opening: '1200.50',
      openingDate: '2026-01-01',
      holderIds: [who.owner],
    });
    await create('owner', {
      type: 'checking',
      name: 'Dólares',
      currency: 'USD',
      opening: '100',
      holderIds: [who.owner, who.admin],
    });
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      const accounts = await list(persona);
      expect(accounts.map((account) => account.name)).toEqual(['BPI', 'Dólares']);
      const [eur, usd] = accounts;
      expect(eur).toMatchObject({ balance: '1200.5', balanceEur: '1200.5', currency: 'EUR' });
      // 100 USD × the seeded 0.92.
      expect(usd).toMatchObject({ balance: '100', balanceEur: '92', currency: 'USD' });
      for (const account of accounts) expect(AccountDto.parse(account)).toEqual(account);
    }
  });

  it('counts the opening balance only from its date', async () => {
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const account = await checking({ opening: '500', openingDate: future });
    expect(account).toMatchObject({ opening: '500', balance: '0', balanceEur: '0' });
  });

  it('uses the pool’s own FX override for the EUR value', async () => {
    await world.settings.update(await s.as('owner'), s.poolA, { fxOverrides: { USD: '0.5' } });
    const who = await people();
    const account = await create('owner', {
      type: 'checking',
      name: 'USD',
      currency: 'USD',
      opening: '100',
      holderIds: [who.owner],
    });
    expect(account.balanceEur).toBe('50');
  });

  it('gets one account, and answers 404 for an unknown id, a malformed id and another pool', async () => {
    const created = await checking();
    expect(await world.accounts.get(await s.as('viewer'), s.poolA, created.id)).toEqual(created);
    await expect(
      world.accounts.get(await s.as('viewer'), s.poolA, '0192f3a1-0000-7000-8000-000000000001'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.accounts.get(await s.as('viewer'), s.poolA, 'nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.accounts.get(await s.as('outsider'), s.poolB, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a request without a session and hides the pool from a non-member', async () => {
    await expect(world.accounts.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(list('outsider')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never shows the accounts of another pool', async () => {
    await checking();
    const theirs = await people(s.poolB, 'outsider');
    await create(
      'outsider',
      { type: 'savings', name: 'Poupança B', currency: 'EUR', holderIds: [theirs.outsider] },
      s.poolB,
    );
    expect((await list('owner')).map((account) => account.name)).toEqual(['BPI']);
    expect((await list('outsider', s.poolB)).map((account) => account.name)).toEqual([
      'Poupança B',
    ]);
  });
});

describe('accounts service: creating', () => {
  it('lets owner and admin create, and refuses member and viewer with 403', async () => {
    const who = await people();
    const body = { type: 'checking', name: 'X', currency: 'EUR', holderIds: [who.owner] };
    await create('owner', body);
    await create('admin', { ...body, name: 'Y' });
    for (const persona of ['member', 'viewer'] as const) {
      await expect(create(persona, body)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(create('outsider', body)).rejects.toBeInstanceOf(NotFoundError);
    expect(await list('owner')).toHaveLength(2);
  });

  it('stores the IBAN without spaces and in upper case, and rejects a wrong one with 400', async () => {
    expect((await checking({ iban: SPACED })).iban).toBe(IBAN);
    await expect(
      checking({ iban: 'PT50000201231234567890155', name: 'bad' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(checking({ iban: 'not an iban', name: 'bad' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses a duplicate IBAN in the same pool (409) and allows it in another pool', async () => {
    await checking({ iban: IBAN });
    await expect(checking({ iban: SPACED, name: 'dup' })).rejects.toBeInstanceOf(ConflictError);
    const theirs = await people(s.poolB, 'outsider');
    const other = await create(
      'outsider',
      { type: 'checking', name: 'B', currency: 'EUR', iban: IBAN, holderIds: [theirs.outsider] },
      s.poolB,
    );
    expect(other.iban).toBe(IBAN);
    expect(await list('owner')).toHaveLength(1);
  });

  it('creates the Banco Invest account with four sub-accounts, one per person', async () => {
    const who = await people();
    const account = await create('owner', {
      type: 'brokerage',
      name: 'Banco Invest Longo Prazo',
      institution: 'Banco Invest',
      currency: 'EUR',
      trackCash: false,
      holderIds: [who.owner, who.admin, who.member, who.viewer],
      subAccounts: [
        { name: 'Rui', holderId: who.owner },
        { name: 'Liliana', holderId: who.admin },
        { name: 'Simão', holderId: who.member },
        { name: 'Vicente', holderId: who.viewer },
      ],
    });
    expect(account.holderIds.sort()).toEqual([who.owner, who.admin, who.member, who.viewer].sort());
    expect(account.subAccounts.map((sub) => sub.name)).toEqual([
      'Rui',
      'Liliana',
      'Simão',
      'Vicente',
    ]);
    expect(account.trackCash).toBe(false);
    expect(account.subAccounts.map((sub) => sub.holderId)).toEqual([
      who.owner,
      who.admin,
      who.member,
      who.viewer,
    ]);
  });

  it('allows several holders and a portfolio link, and links an account to a portfolio id', async () => {
    const who = await people();
    const { id: portfolioId } = await world.portfolios.create(await s.as('owner'), s.poolA, {
      name: 'Fundo de emergência',
      color: '#112233',
      currency: 'EUR',
    });
    const account = await create('owner', {
      type: 'savings',
      name: 'Poupança',
      currency: 'EUR',
      rate: '2.5',
      groupName: 'Fundo de emergência',
      portfolioId,
      holderIds: [who.owner, who.admin],
    });
    expect(account).toMatchObject({ rate: '2.5', groupName: 'Fundo de emergência', portfolioId });
    expect(account.holderIds).toHaveLength(2);
  });

  it('refuses a portfolio of another pool and unlinks the account when the portfolio is deleted', async () => {
    const who = await people();
    const own = await world.portfolios.create(await s.as('owner'), s.poolA, {
      name: 'Reforma',
      color: '#112233',
      currency: 'EUR',
    });
    const other = await world.portfolios.create(await s.as('outsider'), s.poolB, {
      name: 'Outra',
      color: '#445566',
      currency: 'EUR',
    });
    const body = { type: 'savings', name: 'Poupança', currency: 'EUR', holderIds: [who.owner] };
    await expect(create('owner', { ...body, portfolioId: other.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const account = await create('owner', { ...body, portfolioId: own.id });
    await world.portfolios.remove(await s.as('owner'), s.poolA, own.id);
    expect((await world.accounts.get(await s.as('owner'), s.poolA, account.id)).portfolioId).toBeNull();
  });

  it.each([
    ['sub-accounts on a checking account', { type: 'checking', subAccounts: [{ name: 'x' }] }],
    ['a term deposit in USD', { type: 'term_deposit', currency: 'USD' }],
    ['no holder', { holderIds: [] }],
    ['the same holder twice', { holderIds: 'dup' }],
    ['a person of another pool', { holderIds: ['0192f3a1-0000-7000-8000-000000000001'] }],
    [
      'a sub-account person who does not own the account',
      { type: 'brokerage', subAccounts: 'stranger' },
    ],
    ['a currency outside the list', { currency: 'JPY' }],
    ['an opening balance that is not a decimal', { opening: '12,5' }],
    ['an opening balance as a number', { opening: 12.5 }],
    ['a rate above 100', { rate: '100.5' }],
    ['an empty name', { name: '   ' }],
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['the id', { id: '0192f3a1-0000-7000-8000-000000000001' }],
    ['a malformed opening date', { openingDate: '2026-13-01' }],
  ])('rejects %s with 400', async (_name, patch) => {
    const who = await people();
    const body: Record<string, unknown> = {
      type: 'checking',
      name: 'X',
      currency: 'EUR',
      holderIds: [who.owner],
      ...patch,
    };
    if (body.holderIds === 'dup') body.holderIds = [who.owner, who.owner];
    if (body.subAccounts === 'stranger') {
      body.subAccounts = [{ name: 'S', holderId: who.admin }];
    }
    await expect(create('owner', body)).rejects.toBeInstanceOf(ValidationError);
    expect(await list('owner')).toEqual([]);
  });

  it('refuses a holder that belongs to another pool', async () => {
    const theirs = await people(s.poolB, 'outsider');
    await expect(
      create('owner', {
        type: 'checking',
        name: 'X',
        currency: 'EUR',
        holderIds: [theirs.outsider],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores injection payloads in text fields literally', async () => {
    const payload = "'; DROP TABLE accounts; --";
    const account = await checking({
      name: "' OR 1=1 --",
      institution: payload,
      groupName: payload,
      xtbAccountNo: 'x',
    });
    expect(account).toMatchObject({ name: "' OR 1=1 --", institution: payload });
    expect(await list('owner')).toHaveLength(1);
  });

  it('writes one audit entry that names nothing but the id', async () => {
    const account = await checking({ iban: IBAN, opening: '999.99', name: 'Segredo' });
    const entries = await rows<{ action: string; target: string; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where action = 'account.created' and target = ${account.id}`,
    );
    expect(entries).toHaveLength(1);
    const text = JSON.stringify(entries[0]);
    for (const secret of [IBAN, '999.99', 'Segredo']) expect(text).not.toContain(secret);
  });
});

describe('accounts service: updating', () => {
  it('changes some fields and keeps the others, and replaces the holders', async () => {
    const who = await people();
    const account = await checking({ iban: IBAN, opening: '10' });
    const changed = await update('admin', account.id, {
      name: 'Novo nome',
      holderIds: [who.admin, who.member],
      institution: null,
    });
    expect(changed).toMatchObject({ name: 'Novo nome', iban: IBAN, opening: '10' });
    expect(changed.holderIds.sort()).toEqual([who.admin, who.member].sort());
    const cleared = await update('owner', account.id, { iban: null });
    expect(cleared.iban).toBeNull();
  });

  it('refuses member and viewer with 403, a non-member with 404, and another pool’s account with 404', async () => {
    const account = await checking();
    for (const persona of ['member', 'viewer'] as const) {
      await expect(update(persona, account.id, { name: 'x' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(update('outsider', account.id, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await people(s.poolB, 'outsider');
    const other = await create(
      'outsider',
      { type: 'checking', name: 'B', currency: 'EUR', holderIds: [theirs.outsider] },
      s.poolB,
    );
    await expect(update('owner', other.id, { name: 'hijacked' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await list('outsider', s.poolB))[0]?.name).toBe('B');
  });

  it('refuses a duplicate IBAN (409), an empty holder list (400) and mass assignment (400)', async () => {
    await checking({ iban: IBAN });
    const second = await checking({ name: 'Segunda' });
    await expect(update('owner', second.id, { iban: SPACED })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(update('owner', second.id, { holderIds: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      update('owner', second.id, { poolId: '0192f3a1-0000-7000-8000-000000000001' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps the person of a sub-account as an owner, and the account type while it has sub-accounts', async () => {
    const who = await people();
    const account = await create('owner', {
      type: 'brokerage',
      name: 'Corretora',
      currency: 'EUR',
      holderIds: [who.owner, who.admin],
      subAccounts: [{ name: 'Ana', holderId: who.admin }],
    });
    await expect(update('owner', account.id, { holderIds: [who.owner] })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(update('owner', account.id, { type: 'checking' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(update('owner', account.id, { type: 'term_deposit' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      (await update('owner', account.id, { holderIds: [who.owner, who.admin] })).holderIds,
    ).toHaveLength(2);
  });
});

describe('accounts service: deleting', () => {
  it('lets owner and admin delete, and takes the sub-accounts along', async () => {
    const who = await people();
    const account = await create('owner', {
      type: 'brokerage',
      name: 'Corretora',
      currency: 'EUR',
      holderIds: [who.owner],
      subAccounts: [{ name: 'Ana' }],
    });
    await expect(
      world.accounts.remove(await s.as('viewer'), s.poolA, account.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await world.accounts.remove(await s.as('admin'), s.poolA, account.id);
    expect(await list('owner')).toEqual([]);
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, account.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const left = await world.database.asMigrator(
      async (pool) => (await pool.query<{ id: string }>('select id from sub_accounts')).rows,
    );
    expect(left).toEqual([]);
  });

  it('never deletes the account of another pool', async () => {
    const theirs = await people(s.poolB, 'outsider');
    const other = await create(
      'outsider',
      { type: 'checking', name: 'B', currency: 'EUR', holderIds: [theirs.outsider] },
      s.poolB,
    );
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, other.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await list('outsider', s.poolB)).toHaveLength(1);
  });

  it('stops a person from being removed while an account names them', async () => {
    const who = await people();
    const manual = await world.holders.create(await s.as('owner'), s.poolA, { name: 'Simão' });
    await create('owner', {
      type: 'checking',
      name: 'Do Simão',
      currency: 'EUR',
      holderIds: [manual.id, who.owner],
    });
    await expect(
      world.holders.remove(await s.as('owner'), s.poolA, manual.id),
    ).rejects.toBeInstanceOf(ConflictError);
    const account = (await list('owner'))[0];
    await update('owner', account?.id ?? '', { holderIds: [who.owner] });
    await world.holders.remove(await s.as('owner'), s.poolA, manual.id);
  });
});

describe('accounts service: sub-accounts', () => {
  const brokerage = async () => {
    const who = await people();
    const account = await create('owner', {
      type: 'brokerage',
      name: 'Corretora',
      currency: 'EUR',
      holderIds: [who.owner, who.admin],
    });
    return { account, who };
  };
  const add = async (as: Persona, accountId: string, body: unknown, poolId = s.poolA) =>
    world.accounts.createSubAccount(await s.as(as), poolId, accountId, body);

  it('adds, renames, changes the person and removes a sub-account', async () => {
    const { account, who } = await brokerage();
    const sub = await add('owner', account.id, { name: 'Rui', holderId: who.owner });
    expect(SubAccountDto.parse(sub)).toEqual(sub);
    expect(sub).toMatchObject({ accountId: account.id, name: 'Rui', holderId: who.owner });

    const renamed = await world.accounts.updateSubAccount(
      await s.as('admin'),
      s.poolA,
      account.id,
      sub.id,
      { name: 'Rui G.', holderId: who.admin },
    );
    expect(renamed).toMatchObject({ name: 'Rui G.', holderId: who.admin });
    const cleared = await world.accounts.updateSubAccount(
      await s.as('owner'),
      s.poolA,
      account.id,
      sub.id,
      { holderId: null },
    );
    expect(cleared.holderId).toBeNull();

    await world.accounts.removeSubAccount(await s.as('owner'), s.poolA, account.id, sub.id);
    expect(
      (await world.accounts.get(await s.as('owner'), s.poolA, account.id)).subAccounts,
    ).toEqual([]);
    await expect(
      world.accounts.removeSubAccount(await s.as('owner'), s.poolA, account.id, sub.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a sub-account on a non-brokerage account, a stranger as person and a repeated name', async () => {
    const { account, who } = await brokerage();
    const plain = await checking();
    await expect(add('owner', plain.id, { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      add('owner', account.id, { name: 'x', holderId: who.member }),
    ).rejects.toBeInstanceOf(ValidationError);
    await add('owner', account.id, { name: 'Rui' });
    await expect(add('owner', account.id, { name: 'Rui' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses member and viewer (403), a non-member (404) and an account of another pool (404)', async () => {
    const { account } = await brokerage();
    for (const persona of ['member', 'viewer'] as const) {
      await expect(add(persona, account.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(add('outsider', account.id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await people(s.poolB, 'outsider');
    const other = await create(
      'outsider',
      { type: 'brokerage', name: 'B', currency: 'EUR', holderIds: [theirs.outsider] },
      s.poolB,
    );
    await expect(add('owner', other.id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    const sub = await add('outsider', other.id, { name: 'S' }, s.poolB);
    await expect(
      world.accounts.removeSubAccount(await s.as('owner'), s.poolA, other.id, sub.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.accounts.updateSubAccount(await s.as('owner'), s.poolA, account.id, sub.id, {
        name: 'hijacked',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an unknown field, an empty name and a malformed id', async () => {
    const { account } = await brokerage();
    await expect(add('owner', account.id, { name: 'x', poolId: 'y' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(add('owner', account.id, { name: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(add('owner', 'nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
