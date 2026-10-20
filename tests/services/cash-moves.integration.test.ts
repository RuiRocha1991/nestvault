import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CashMoveDto,
  ConflictError,
  ForbiddenError,
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

const holder = async (poolId = s.poolA, as: Persona = 'owner') =>
  (await world.holders.list(await s.as(as), poolId)).holders[0]?.id ?? '';

const account = async (
  type = 'checking',
  name = 'Conta',
  poolId = s.poolA,
  as: Persona = 'owner',
) =>
  world.accounts.create(await s.as(as), poolId, {
    type,
    name,
    currency: 'EUR',
    holderIds: [await holder(poolId, as)],
  });

/** A portfolio holding 500 € of cash (a dividend not settled in any account) and a checking account. */
async function setup(poolId = s.poolA, as: Persona = 'owner') {
  const headers = await s.as(as);
  const p = await world.portfolios.create(headers, poolId, {
    name: 'Reforma',
    color: '#112233',
    currency: 'EUR',
  });
  const x = await world.assets.create(headers, poolId, {
    ticker: 'PPR',
    name: 'PPR Fund',
    type: 'fund',
    currency: 'EUR',
  });
  await world.ops.create(headers, poolId, {
    portfolioId: p.id,
    assetId: x.id,
    type: 'dividend',
    date: '2026-03-01',
    amount: '500',
  });
  const acc = await account('checking', 'Conta', poolId, as);
  return { p, x, acc };
}

const move = async (
  as: Persona,
  portfolioId: string,
  body: unknown,
  poolId = s.poolA,
): Promise<CashMoveDto> => world.cashMoves.create(await s.as(as), poolId, portfolioId, body);

const portfolioCash = async (portfolioId: string) =>
  (
    await world.portfolios.summary(await s.as('owner'), s.poolA, {
      portfolioId,
      asOf: '2026-12-31',
    })
  ).cash;

const balanceOf = async (accountId: string) =>
  (await world.accounts.get(await s.as('owner'), s.poolA, accountId)).balance;

const transactionsOf = async (accountId: string) =>
  (await world.transactions.list(await s.as('owner'), s.poolA, { accountId })).transactions;

describe('moving portfolio cash to an account', () => {
  it('rejects a move larger than the available cash, and accepts exactly all of it', async () => {
    const { p, acc } = await setup();
    const body = { accountId: acc.id, date: '2026-03-10' };
    await expect(move('owner', p.id, { ...body, amount: '500.01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await portfolioCash(p.id)).toBe('500');
    expect(await world.cashMoves.list(await s.as('owner'), s.poolA, p.id)).toEqual({ moves: [] });

    const all = await move('owner', p.id, { ...body, amount: '500' });
    expect(CashMoveDto.parse(all)).toEqual(all);
    expect(all).toMatchObject({ amount: '500', mirror: false, transactionId: null });
    expect(await portfolioCash(p.id)).toBe('0');
    // Nothing is left to move.
    await expect(move('owner', p.id, { ...body, amount: '0.01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('counts the cash on the date of the move, not today', async () => {
    const { p, acc } = await setup();
    await expect(
      move('owner', p.id, { accountId: acc.id, date: '2026-02-01', amount: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('with a mirror: the account rises, the portfolio cash falls and net worth is unchanged', async () => {
    const { p, acc } = await setup();
    const before = Number(await balanceOf(acc.id)) + Number(await portfolioCash(p.id));

    const created = await move('member', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '120.5',
      mirror: true,
      note: 'Para as férias',
    });
    expect(created).toMatchObject({ amount: '120.5', mirror: true, note: 'Para as férias' });

    expect(await balanceOf(acc.id)).toBe('120.5');
    expect(await portfolioCash(p.id)).toBe('379.5');
    expect(Number(await balanceOf(acc.id)) + Number(await portfolioCash(p.id))).toBe(before);

    const [line, ...rest] = await transactionsOf(acc.id);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      id: created.transactionId,
      amount: '120.5',
      date: '2026-03-10',
      transfer: true,
      transferLocked: true,
      kind: 'transfer',
    });
  });

  it('without a mirror: only the portfolio cash falls, and the imported line is a transfer, not income', async () => {
    const { p, acc } = await setup();
    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '200',
    });
    expect(created).toMatchObject({ mirror: false, transactionId: null });
    expect(await portfolioCash(p.id)).toBe('300');
    expect(await balanceOf(acc.id)).toBe('0');
    expect(await transactionsOf(acc.id)).toEqual([]);

    // The statement brings the line two days later: it is paired with the move.
    const imported = await world.transactions.create(await s.as('owner'), s.poolA, {
      accountId: acc.id,
      date: '2026-03-12',
      description: 'TRF PPR FUND',
      amount: '200',
    });
    expect(imported).toMatchObject({ transfer: true, kind: 'transfer' });
    const [after] = (await world.cashMoves.list(await s.as('owner'), s.poolA, p.id)).moves;
    expect(after).toMatchObject({ id: created.id, transactionId: imported.id, mirror: false });
    expect(await balanceOf(acc.id)).toBe('200');
  });

  it('recognises a line that was imported before the move was recorded', async () => {
    const { p, acc } = await setup();
    const imported = await world.transactions.create(await s.as('owner'), s.poolA, {
      accountId: acc.id,
      date: '2026-03-10',
      description: 'TRF PPR FUND',
      amount: '75',
    });
    expect(imported).toMatchObject({ transfer: false, kind: 'income' });

    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-11',
      amount: '75',
    });
    expect((await world.cashMoves.list(await s.as('owner'), s.poolA, p.id)).moves[0]).toMatchObject(
      { id: created.id, transactionId: imported.id },
    );
    const [line] = await transactionsOf(acc.id);
    expect(line).toMatchObject({ id: imported.id, transfer: true, kind: 'transfer' });
  });

  it('does not match a line with another amount, outside the window, or already used by a mirror', async () => {
    const { p, acc } = await setup();
    await move('owner', p.id, { accountId: acc.id, date: '2026-03-10', amount: '50' });
    const create = async (date: string, amount: string) =>
      world.transactions.create(await s.as('owner'), s.poolA, {
        accountId: acc.id,
        date,
        description: 'Entrada',
        amount,
      });
    expect(await create('2026-03-10', '50.01')).toMatchObject({ transfer: false });
    expect(await create('2026-03-20', '50')).toMatchObject({ transfer: false });
    // The mirror of another move holds a 50 € line, which a second pending move must not take.
    await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-04-10',
      amount: '60',
      mirror: true,
    });
    await move('owner', p.id, { accountId: acc.id, date: '2026-04-10', amount: '60' });
    const moves = (await world.cashMoves.list(await s.as('owner'), s.poolA, p.id)).moves;
    expect(moves.filter((m) => m.transactionId === null)).toHaveLength(2);
  });

  it('undo: deleting a move deletes the mirror it created, but not an imported line', async () => {
    const { p, acc } = await setup();
    const mirrored = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '100',
      mirror: true,
    });
    expect(await transactionsOf(acc.id)).toHaveLength(1);
    await world.cashMoves.remove(await s.as('member'), s.poolA, p.id, mirrored.id);
    expect(await transactionsOf(acc.id)).toEqual([]);
    expect(await balanceOf(acc.id)).toBe('0');
    expect(await portfolioCash(p.id)).toBe('500');
    await expect(
      world.cashMoves.remove(await s.as('owner'), s.poolA, p.id, mirrored.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    const plain = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '30',
    });
    const imported = await world.transactions.create(await s.as('owner'), s.poolA, {
      accountId: acc.id,
      date: '2026-03-10',
      description: 'TRF',
      amount: '30',
    });
    await world.cashMoves.remove(await s.as('owner'), s.poolA, p.id, plain.id);
    expect((await transactionsOf(acc.id)).map((line) => line.id)).toEqual([imported.id]);
  });

  it('keeps the move when its mirror is deleted by hand', async () => {
    const { p, acc } = await setup();
    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '100',
      mirror: true,
    });
    await world.transactions.remove(await s.as('owner'), s.poolA, created.transactionId ?? '');
    const [kept] = (await world.cashMoves.list(await s.as('owner'), s.poolA, p.id)).moves;
    expect(kept).toMatchObject({ id: created.id, transactionId: null });
  });

  it('accepts only a checking or savings account of the pool', async () => {
    const { p } = await setup();
    const brokerage = await account('brokerage', 'XTB');
    await expect(
      move('owner', p.id, { accountId: brokerage.id, date: '2026-03-10', amount: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      move('owner', p.id, {
        accountId: '0192f3a1-0000-7000-8000-000000000001',
        date: '2026-03-10',
        amount: '1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates the body: positive amount, strict fields', async () => {
    const { p, acc } = await setup();
    const ok = { accountId: acc.id, date: '2026-03-10', amount: '10' };
    for (const bad of [
      { amount: '0' },
      { amount: '-5' },
      { amount: '1.12345' },
      { amount: 'abc' },
      { date: '10/03/2026' },
      { poolId: s.poolB },
      { portfolioId: p.id },
      { transactionId: p.id },
      { mirror: 'yes' },
    ]) {
      await expect(move('owner', p.id, { ...ok, ...bad })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(move('owner', p.id, { date: ok.date, amount: ok.amount })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('allows owner, admin and member to move cash; refuses the viewer (403)', async () => {
    const { p, acc } = await setup();
    const body = { accountId: acc.id, date: '2026-03-10', amount: '10' };
    for (const as of ['owner', 'admin', 'member'] as const) {
      await move(as, p.id, body);
    }
    await expect(move('viewer', p.id, body)).rejects.toBeInstanceOf(ForbiddenError);
    const [first] = (await world.cashMoves.list(await s.as('viewer'), s.poolA, p.id)).moves;
    await expect(
      world.cashMoves.remove(await s.as('viewer'), s.poolA, p.id, first?.id ?? ''),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await world.cashMoves.list(await s.as('viewer'), s.poolA, p.id)).moves).toHaveLength(3);
  });

  it('hides the pool from a non-member and refuses a request without a session', async () => {
    const { p, acc } = await setup();
    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '10',
    });
    const body = { accountId: acc.id, date: '2026-03-10', amount: '1' };
    await expect(world.cashMoves.list(new Headers(), s.poolA, p.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(
      world.cashMoves.list(await s.as('outsider'), s.poolA, p.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.cashMoves.create(await s.as('outsider'), s.poolA, p.id, body),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.cashMoves.remove(await s.as('outsider'), s.poolA, p.id, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.cashMoves.list(await s.as('owner'), s.poolA, 'not-an-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('answers 404 for a portfolio or a move of another pool, and leaves it unchanged', async () => {
    const mine = await setup();
    const theirs = await setup(s.poolB, 'outsider');
    const theirMove = await move(
      'outsider',
      theirs.p.id,
      { accountId: theirs.acc.id, date: '2026-03-10', amount: '10' },
      s.poolB,
    );
    const owner = await s.as('owner');
    await expect(world.cashMoves.list(owner, s.poolA, theirs.p.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      move('owner', theirs.p.id, { accountId: mine.acc.id, date: '2026-03-10', amount: '10' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.cashMoves.remove(owner, s.poolA, theirs.p.id, theirMove.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Nor through a portfolio of its own pool.
    await expect(
      world.cashMoves.remove(owner, s.poolA, mine.p.id, theirMove.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    // An account of the other pool is not an account of this one.
    await expect(
      move('owner', mine.p.id, { accountId: theirs.acc.id, date: '2026-03-10', amount: '10' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await world.cashMoves.list(await s.as('outsider'), s.poolB, theirs.p.id)).moves,
    ).toEqual([theirMove]);
  });

  it('does not delete a move through another portfolio of the same pool', async () => {
    const { p, acc, x } = await setup();
    const other = await world.portfolios.create(await s.as('owner'), s.poolA, {
      name: 'Outra',
      color: '#445566',
      currency: 'EUR',
    });
    expect(x.id).toBeTruthy();
    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '10',
    });
    await expect(
      world.cashMoves.remove(await s.as('owner'), s.poolA, other.id, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is written to the audit log by id, never with amounts or notes', async () => {
    const { p, acc } = await setup();
    const created = await move('owner', p.id, {
      accountId: acc.id,
      date: '2026-03-10',
      amount: '12.34',
      note: 'segredo',
    });
    await world.cashMoves.remove(await s.as('owner'), s.poolA, p.id, created.id);
    const log = JSON.stringify(
      await rows(
        world.identity,
        sql`select action, target, meta from audit_log where action like 'cashmove.%'`,
      ),
    );
    expect(log).toContain('cashmove.created');
    expect(log).toContain('cashmove.deleted');
    expect(log).toContain(created.id);
    expect(log).not.toContain('12.34');
    expect(log).not.toContain('segredo');
  });
});

describe('portfolios with cash moves', () => {
  it('asks what to do with the moves when the portfolio is deleted (409), then moves or deletes them', async () => {
    const { p, acc } = await setup();
    const other = await world.portfolios.create(await s.as('owner'), s.poolA, {
      name: 'Outra',
      color: '#445566',
      currency: 'EUR',
    });
    await move('owner', p.id, { accountId: acc.id, date: '2026-03-10', amount: '40' });
    const owner = await s.as('owner');
    // The dividend is an operation too, so the 409 holds with or without the move; deleting the
    // operations while keeping the move must not lose it silently.
    await expect(world.portfolios.remove(owner, s.poolA, p.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await world.portfolios.remove(owner, s.poolA, p.id, { moveTo: other.id });
    expect((await world.cashMoves.list(owner, s.poolA, other.id)).moves).toHaveLength(1);
    await world.portfolios.remove(owner, s.poolA, other.id, { deleteOps: 'true' });
    await expect(world.cashMoves.list(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses to delete an account that cash moves name (409)', async () => {
    const { p, acc } = await setup();
    await move('owner', p.id, { accountId: acc.id, date: '2026-03-10', amount: '40' });
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, acc.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
