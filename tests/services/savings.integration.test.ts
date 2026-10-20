import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  DepositDto,
  DepositScheduleDto,
  ForbiddenError,
  InterestEntryDto,
  logger,
  NotFoundError,
  ProductDto,
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

/** The persona that owns the pool: `owner` for pool A, `outsider` for pool B. */
const ownerOf = (poolId: string): Persona => (poolId === s.poolB ? 'outsider' : 'owner');
const holder = async (poolId = s.poolA) =>
  (await world.holders.list(await s.as(ownerOf(poolId)), poolId)).holders[0]?.id ?? '';
const account = async (type: string, name: string, extra: object = {}, poolId = s.poolA) =>
  world.accounts.create(await s.as(ownerOf(poolId)), poolId, {
    type,
    name,
    currency: 'EUR',
    holderIds: [await holder(poolId)],
    ...extra,
  });
const product = async (as: Persona, body: unknown = {}, poolId = s.poolA) =>
  world.products.create(await s.as(as), poolId, {
    name: 'Depósito 12M',
    rate: '2.5',
    payN: 3,
    payU: 'm',
    termN: 12,
    termU: 'm',
    ...(body as object),
  });
const deposit = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.deposits.create(await s.as(as), poolId, body);

/** A term-deposit account with a deposit of 10 000 € at 2,5 % paid quarterly (domain fixture). */
async function fixture() {
  const prod = await product('owner');
  const term = await account('term_deposit', 'Depósito Alfa');
  const dep = await deposit('owner', {
    accountId: term.id,
    productId: prod.id,
    capital: '10000',
    start: '2025-01-15',
  });
  return { prod, term, dep };
}

describe('savings products service', () => {
  it('lets owner and admin manage products; member and viewer get 403', async () => {
    const created = await product('owner', { institution: 'Banco Alfa', tax: '25.5' });
    expect(ProductDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      name: 'Depósito 12M',
      rate: '2.5',
      payN: 3,
      payU: 'm',
      tax: '25.5',
      depositsCount: 0,
      capital: '0',
      averageRate: null,
    });
    const changed = await world.products.update(await s.as('admin'), s.poolA, created.id, {
      rate: '3.1234',
      termN: null,
      termU: null,
      institution: null,
    });
    expect(changed).toMatchObject({ rate: '3.1234', termN: null, termU: null, institution: null });
    for (const as of ['member', 'viewer'] as const) {
      await expect(product(as, { name: 'Outro' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.products.update(await s.as(as), s.poolA, created.id, { rate: '1' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.products.remove(await s.as(as), s.poolA, created.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await world.products.list(await s.as(as), s.poolA)).products).toHaveLength(1);
    }
    await world.products.remove(await s.as('owner'), s.poolA, created.id);
    await expect(
      world.products.get(await s.as('owner'), s.poolA, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates the rate and tax (0-100, up to 4 decimals), the periods and the name', async () => {
    for (const bad of [
      { rate: '100.01' },
      { rate: '-1' },
      { rate: '2.12345' },
      { rate: 'abc' },
      { rate: '2e1' },
      { tax: '100.5' },
      { tax: '12.34567' },
      { payN: 3, payU: null },
      { payN: null, payU: 'm' },
      { termN: 12, termU: null },
      { payN: 0, payU: 'm' },
      { payU: 'y' },
      { name: '' },
      { name: 'x'.repeat(81) },
      { poolId: s.poolB },
      { id: '0192f3a1-0000-7000-8000-000000000001' },
    ]) {
      await expect(product('owner', { name: 'Mau', ...bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    // The edge values are fine.
    await product('owner', { name: 'Zero', rate: '0', tax: '100' });
    await product('owner', { name: 'Cem', rate: '100.0000', tax: '0.0001' });
    // An update is validated as a whole: it cannot leave a number without its unit.
    const prod = await product('owner', { name: 'Para alterar' });
    await expect(
      world.products.update(await s.as('owner'), s.poolA, prod.id, { payU: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.products.update(await s.as('owner'), s.poolA, prod.id, {}),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('answers 409 for a repeated name, and refuses accounts of another pool or term deposits', async () => {
    await product('owner');
    await expect(product('admin')).rejects.toBeInstanceOf(ConflictError);
    const own = await account('savings', 'Poupança');
    const term = await account('term_deposit', 'Prazo');
    const foreign = await account('savings', 'Beta', {}, s.poolB);
    await product('owner', {
      name: 'Com contas',
      payToAccountId: own.id,
      fundFromAccountId: own.id,
    });
    for (const accountId of [foreign.id, term.id, '0192f3a1-0000-7000-8000-000000000001']) {
      await expect(
        product('owner', { name: 'Mau destino', payToAccountId: accountId }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    // An account that a product names cannot be deleted.
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, own.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('groups the deposits of a product: count, total capital and the rate weighted by capital', async () => {
    const prod = await product('owner', { rate: '2' });
    const other = await account('term_deposit', 'Prazo 2');
    const first = await account('term_deposit', 'Prazo 1');
    await deposit('owner', {
      accountId: first.id,
      productId: prod.id,
      capital: '10000',
      start: '2026-01-01',
      rate: '2',
    });
    await deposit('owner', {
      accountId: other.id,
      productId: prod.id,
      capital: '30000',
      start: '2026-01-01',
      rate: '3',
    });
    const [grouped] = (await world.products.list(await s.as('viewer'), s.poolA)).products;
    expect(grouped).toMatchObject({ depositsCount: 2, capital: '40000', averageRate: '2.75' });
    expect(await world.products.get(await s.as('viewer'), s.poolA, prod.id)).toEqual(grouped);
  });

  it('refuses to delete a product that has deposits (409), and keeps deposits when it changes', async () => {
    const { prod, dep } = await fixture();
    await expect(
      world.products.remove(await s.as('owner'), s.poolA, prod.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await world.products.update(await s.as('owner'), s.poolA, prod.id, { rate: '9' });
    expect(await world.deposits.get(await s.as('owner'), s.poolA, dep.id)).toMatchObject({
      rate: '2.5',
    });
    await world.deposits.remove(await s.as('owner'), s.poolA, dep.id);
    await world.products.remove(await s.as('owner'), s.poolA, prod.id);
  });

  it('hides the pool from a non-member, refuses no session, and never shows another pool’s products', async () => {
    const mine = await product('owner');
    const theirs = await product('outsider', { name: 'Beta' }, s.poolB);
    await expect(world.products.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.products.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const outsider = await s.as('outsider');
    for (const call of [
      () => world.products.get(outsider, s.poolB, mine.id),
      () => world.products.update(outsider, s.poolB, mine.id, { rate: '1' }),
      () => world.products.remove(outsider, s.poolB, mine.id),
      () => world.products.get(outsider, s.poolA, theirs.id),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await world.products.get(outsider, s.poolB, theirs.id)).toEqual(theirs);
    await expect(
      world.products.get(await s.as('owner'), s.poolA, 'not-an-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records the changes in the audit log without the product’s data', async () => {
    const prod = await product('owner', { name: 'Segredo Alfa' });
    await world.products.update(await s.as('owner'), s.poolA, prod.id, { rate: '4' });
    await world.products.remove(await s.as('owner'), s.poolA, prod.id);
    const entries = await rows<{ action: string; target: string | null; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where action like 'product.%' and target = ${prod.id} order by at`,
    );
    expect(entries.map((entry) => entry.action)).toEqual([
      'product.created',
      'product.updated',
      'product.deleted',
    ]);
    expect(entries.every((entry) => entry.target === prod.id)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('Segredo Alfa');
  });
});

describe('deposits service', () => {
  it('pre-fills a new deposit from the product, and what is sent overrides it', async () => {
    const prod = await product('owner', {
      institution: 'Banco Alfa',
      tax: '20',
      fundFromAccountId: (await account('checking', 'Ordem')).id,
    });
    const filled = await deposit('owner', {
      accountId: (await account('term_deposit', 'Prazo 1')).id,
      productId: prod.id,
      capital: '5000',
      start: '2026-03-01',
    });
    expect(DepositDto.parse(filled)).toEqual(filled);
    expect(filled).toMatchObject({
      productId: prod.id,
      capital: '5000',
      start: '2026-03-01',
      rate: '2.5',
      payN: 3,
      payU: 'm',
      termN: 12,
      termU: 'm',
      tax: '20',
      fundFromAccountId: prod.fundFromAccountId,
      payToAccountId: null,
      capitalize: false,
      maturity: '2027-03-01',
    });

    const overridden = await deposit('owner', {
      accountId: (await account('term_deposit', 'Prazo 2')).id,
      productId: prod.id,
      capital: '7000.5',
      start: '2026-03-01',
      rate: '3.2',
      payN: null,
      payU: null,
      termN: 6,
      termU: 'm',
      tax: null,
      fundFromAccountId: null,
      capitalize: true,
    });
    expect(overridden).toMatchObject({
      rate: '3.2',
      payN: null,
      payU: null,
      termN: 6,
      tax: null,
      fundFromAccountId: null,
      capitalize: true,
      capital: '7000.5',
      maturity: '2026-09-01',
    });
    // The overrides persist.
    expect(await world.deposits.get(await s.as('viewer'), s.poolA, overridden.id)).toEqual(
      overridden,
    );
    expect((await world.deposits.list(await s.as('viewer'), s.poolA)).deposits).toHaveLength(2);
  });

  it('works without a product but then needs the rate', async () => {
    const term = await account('term_deposit', 'Prazo');
    await expect(
      deposit('owner', { accountId: term.id, capital: '1000', start: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const created = await deposit('owner', {
      accountId: term.id,
      capital: '1000',
      start: '2026-01-01',
      rate: '1.5',
    });
    expect(created).toMatchObject({ productId: null, rate: '1.5', payN: null, maturity: null });
  });

  it('validates the rate, the tax, the capital, the date and what belongs to the pool', async () => {
    const prod = await product('owner');
    const term = await account('term_deposit', 'Prazo');
    const base = { accountId: term.id, capital: '1000', start: '2026-01-01', rate: '2' };
    for (const bad of [
      { rate: '100.1' },
      { rate: '2.00001' },
      { tax: '100.01' },
      { tax: '-1' },
      { capital: '0' },
      { capital: '-5' },
      { capital: '1.23456' },
      { start: '2026-13-01' },
      { start: '01/01/2026' },
      { payN: 3 },
      { termU: 'm' },
      { poolId: s.poolB },
      { accountId: undefined },
    ]) {
      await expect(deposit('owner', { ...base, ...bad })).rejects.toBeInstanceOf(ValidationError);
    }
    const checking = await account('checking', 'Ordem');
    const foreignTerm = await account('term_deposit', 'Beta', {}, s.poolB);
    const foreignProduct = await product('outsider', { name: 'Beta' }, s.poolB);
    for (const bad of [
      { accountId: checking.id },
      { accountId: foreignTerm.id },
      { accountId: '0192f3a1-0000-7000-8000-000000000001' },
      { productId: foreignProduct.id },
      { payToAccountId: term.id },
    ]) {
      await expect(deposit('owner', { ...base, ...bad })).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await world.deposits.list(await s.as('owner'), s.poolA)).deposits).toEqual([]);
    expect(prod.depositsCount).toBe(0);
  });

  it('allows one deposit per account (409), and only owner and admin write', async () => {
    const term = await account('term_deposit', 'Prazo');
    const body = { accountId: term.id, capital: '1000', start: '2026-01-01', rate: '2' };
    for (const as of ['member', 'viewer'] as const) {
      await expect(deposit(as, body)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const created = await deposit('admin', body);
    await expect(deposit('owner', body)).rejects.toBeInstanceOf(ConflictError);
    for (const as of ['member', 'viewer'] as const) {
      await expect(
        world.deposits.update(await s.as(as), s.poolA, created.id, { capital: '2' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.deposits.remove(await s.as(as), s.poolA, created.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('updates as a whole and deletes; the account cannot change', async () => {
    const { dep, term } = await fixture();
    const changed = await world.deposits.update(await s.as('owner'), s.poolA, dep.id, {
      capital: '12000.25',
      rate: '3',
      tax: '10',
      payN: null,
      payU: null,
    });
    expect(changed).toMatchObject({
      capital: '12000.25',
      rate: '3',
      tax: '10',
      payN: null,
      termN: 12,
      accountId: term.id,
    });
    await expect(
      world.deposits.update(await s.as('owner'), s.poolA, dep.id, { accountId: s.poolB }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.deposits.update(await s.as('owner'), s.poolA, dep.id, { payN: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.deposits.update(await s.as('owner'), s.poolA, dep.id, { tax: '101' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await world.deposits.get(await s.as('owner'), s.poolA, dep.id)).toEqual(changed);
    await world.deposits.remove(await s.as('owner'), s.poolA, dep.id);
    await expect(
      world.deposits.remove(await s.as('owner'), s.poolA, dep.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The account stays and can get a new deposit.
    await deposit('owner', { accountId: term.id, capital: '1', start: '2026-01-01', rate: '1' });
  });

  it('deletes the deposit with its account', async () => {
    const { dep, term } = await fixture();
    await world.accounts.remove(await s.as('owner'), s.poolA, term.id);
    await expect(world.deposits.get(await s.as('owner'), s.poolA, dep.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('matches the domain fixture: 10 000 € at 2,5 % paid quarterly, 28 % tax', async () => {
    const { dep } = await fixture();
    const schedule = await world.deposits.schedule(await s.as('viewer'), s.poolA, dep.id, {
      asOf: '2025-06-01',
    });
    expect(DepositScheduleDto.parse(schedule)).toEqual(schedule);
    expect(schedule.defaultTax).toBe('28');
    expect(schedule.periods.map((p) => [p.date, p.days, p.base, p.gross, p.net])).toEqual([
      ['2025-04-15', 90, '10000', '61.64', '44.38'],
      ['2025-07-15', 91, '10044.38', '62.61', '45.08'],
      ['2025-10-15', 92, '10089.46', '63.58', '45.78'],
      ['2026-01-15', 92, '10135.24', '63.87', '45.99'],
    ]);
    expect(schedule.value).toMatchObject({
      capital: '10000',
      maturity: '2026-01-15',
      matured: false,
      returned: false,
      next: { date: '2025-07-15', net: '45.08' },
    });
    // Up to the first payment: that interest is in the value, the rest is accrued.
    const later = await world.deposits.schedule(await s.as('viewer'), s.poolA, dep.id, {
      asOf: '2025-04-15',
    });
    expect(later.value).toMatchObject({ paid: '44.38', value: '10044.38', accrued: '0' });
    // At maturity the capital with its capitalized interest is back (no return account here).
    const matured = await world.deposits.schedule(await s.as('viewer'), s.poolA, dep.id, {
      asOf: '2026-02-01',
    });
    expect(matured.value).toMatchObject({ matured: true, next: null });
  });

  it('uses the pool’s default tax unless the deposit has its own', async () => {
    const { dep } = await fixture();
    await world.settings.update(await s.as('owner'), s.poolA, { depositTax: '20' });
    const defaulted = await world.deposits.schedule(await s.as('owner'), s.poolA, dep.id, {
      asOf: '2025-04-15',
    });
    expect(defaulted.defaultTax).toBe('20');
    expect(defaulted.periods[0]).toMatchObject({ gross: '61.64', net: '49.31' });
    await world.deposits.update(await s.as('owner'), s.poolA, dep.id, { tax: '0' });
    const own = await world.deposits.schedule(await s.as('owner'), s.poolA, dep.id, {
      asOf: '2025-04-15',
    });
    expect(own.periods[0]).toMatchObject({ net: '61.64' });
  });

  it('validates the query and hides other pools’ deposits', async () => {
    const { dep } = await fixture();
    const mine = await s.as('owner');
    for (const bad of [{ asOf: '2026-02-30' }, { asOf: 'tomorrow' }, { poolId: s.poolB }]) {
      await expect(world.deposits.schedule(mine, s.poolA, dep.id, bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const outsider = await s.as('outsider');
    await expect(world.deposits.schedule(outsider, s.poolA, dep.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.deposits.schedule(outsider, s.poolB, dep.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const call of [
      () => world.deposits.get(outsider, s.poolB, dep.id),
      () => world.deposits.update(outsider, s.poolB, dep.id, { capital: '1' }),
      () => world.deposits.remove(outsider, s.poolB, dep.id),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(world.deposits.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(await world.deposits.get(mine, s.poolA, dep.id)).toEqual(dep);
  });

  it('feeds the account balance: a term deposit is worth its deposit value', async () => {
    const { term } = await fixture();
    const listed = (await world.accounts.list(await s.as('owner'), s.poolA)).accounts;
    const found = listed.find((a) => a.id === term.id);
    // Started in 2025 and matured long before today, with no return account: capital + interest.
    expect(Number(found?.balance)).toBeGreaterThan(10000);
  });

  it('records the changes in the audit log without the deposit’s data', async () => {
    const { dep } = await fixture();
    await world.deposits.update(await s.as('owner'), s.poolA, dep.id, { capital: '777.77' });
    await world.deposits.remove(await s.as('owner'), s.poolA, dep.id);
    const entries = await rows<{ action: string; target: string | null }>(
      world.identity,
      sql`select action, target from audit_log where action like 'deposit.%' and target = ${dep.id} order by at`,
    );
    expect(entries.map((entry) => entry.action)).toEqual([
      'deposit.created',
      'deposit.updated',
      'deposit.deleted',
    ]);
    expect(
      JSON.stringify(await rows(world.identity, sql`select meta from audit_log`)),
    ).not.toContain('777.77');
  });
});

describe('interest service', () => {
  it('records, lists newest first, filters by account and deletes', async () => {
    const one = await account('savings', 'Poupança 1');
    const two = await account('savings', 'Poupança 2');
    const make = async (accountId: string, date: string, amount: string, as: Persona = 'owner') =>
      world.interest.create(await s.as(as), s.poolA, { accountId, date, amount });
    const first = await make(one.id, '2026-02-01', '12.34', 'admin');
    await make(one.id, '2026-03-01', '1.5');
    await make(two.id, '2026-02-15', '9');
    expect(InterestEntryDto.parse(first)).toEqual(first);
    expect(first).toMatchObject({ accountId: one.id, amount: '12.34', note: null });
    const listed = await world.interest.list(await s.as('viewer'), s.poolA, {
      accountId: one.id,
    });
    expect(listed.entries.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-02-01']);
    expect((await world.interest.list(await s.as('viewer'), s.poolA)).entries).toHaveLength(3);
    await world.interest.remove(await s.as('owner'), s.poolA, first.id);
    await expect(
      world.interest.remove(await s.as('owner'), s.poolA, first.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await world.interest.list(await s.as('viewer'), s.poolA)).entries).toHaveLength(2);
  });

  it('refuses member and viewer (403), bad input (400), and other kinds of accounts', async () => {
    const savings = await account('savings', 'Poupança');
    const checking = await account('checking', 'Ordem');
    const foreign = await account('savings', 'Beta', {}, s.poolB);
    const body = { accountId: savings.id, date: '2026-02-01', amount: '1' };
    for (const as of ['member', 'viewer'] as const) {
      await expect(world.interest.create(await s.as(as), s.poolA, body)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    const owner = await s.as('owner');
    for (const bad of [
      { amount: '0' },
      { amount: '-1' },
      { amount: '1.23456' },
      { amount: 'abc' },
      { date: '2026-02-30' },
      { note: 'x'.repeat(501) },
      { note: 'a\u0000b' },
      { poolId: s.poolB },
    ]) {
      await expect(
        world.interest.create(owner, s.poolA, { ...body, ...bad }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    for (const accountId of [checking.id, foreign.id, '0192f3a1-0000-7000-8000-000000000001']) {
      await expect(
        world.interest.create(owner, s.poolA, { ...body, accountId }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      world.interest.list(owner, s.poolA, { accountId: 'x', extra: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('takes entries for a deposit without a payment schedule but not for a scheduled one', async () => {
    const term = await account('term_deposit', 'Prazo');
    await deposit('owner', {
      accountId: term.id,
      capital: '1000',
      start: '2026-01-01',
      rate: '2',
    });
    const owner = await s.as('owner');
    await world.interest.create(owner, s.poolA, {
      accountId: term.id,
      date: '2026-06-01',
      amount: '5',
    });
    const { dep } = await fixture();
    await expect(
      world.interest.create(owner, s.poolA, {
        accountId: dep.accountId,
        date: '2026-06-01',
        amount: '5',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('adds the entries to the balance, and blocks deleting an account that has them (409)', async () => {
    const savings = await account('savings', 'Poupança', { opening: '1000' });
    const owner = await s.as('owner');
    await world.interest.create(owner, s.poolA, {
      accountId: savings.id,
      date: '2026-02-01',
      amount: '12.34',
      note: "' OR 1=1 --",
    });
    const found = (await world.accounts.list(owner, s.poolA)).accounts.find(
      (a) => a.id === savings.id,
    );
    expect(found?.balance).toBe('1012.34');
    await expect(world.accounts.remove(owner, s.poolA, savings.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const [entry] = (await world.interest.list(owner, s.poolA)).entries;
    expect(entry?.note).toBe("' OR 1=1 --");
  });

  it('never shows or changes another pool’s entries', async () => {
    const mine = await account('savings', 'Poupança');
    const theirs = await account('savings', 'Beta', {}, s.poolB);
    const entry = await world.interest.create(await s.as('owner'), s.poolA, {
      accountId: mine.id,
      date: '2026-02-01',
      amount: '3',
      note: 'Nota Alfa',
    });
    const other = await world.interest.create(await s.as('outsider'), s.poolB, {
      accountId: theirs.id,
      date: '2026-02-01',
      amount: '4',
      note: 'Nota Beta',
    });
    const outsider = await s.as('outsider');
    await expect(world.interest.list(outsider, s.poolA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.interest.remove(outsider, s.poolB, entry.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.interest.create(outsider, s.poolB, {
        accountId: mine.id,
        date: '2026-02-01',
        amount: '1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const seen = JSON.stringify(await world.interest.list(await s.as('owner'), s.poolA));
    expect(seen).not.toContain(other.id);
    expect(seen).not.toContain('Nota Beta');
    await expect(world.interest.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
