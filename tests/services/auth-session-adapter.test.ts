import { describe, expect, it } from 'vitest';

import { hashSessionToken, withHashedSessionTokens } from '@nestvault/services';

type Row = Record<string, unknown>;

/** A tiny in-memory adapter that records what it was asked to store and find. */
type Factory = Parameters<typeof withHashedSessionTokens>[0];
type Inner = ReturnType<Factory>;

function fakeAdapter() {
  const rows: Row[] = [];
  const adapter = {
    create: ({ data }: { data: Row }) => {
      rows.push({ ...data });
      return Promise.resolve({ ...data });
    },
    findOne: ({ where }: { where: { field: string; value: unknown }[] }) =>
      Promise.resolve(rows.find((row) => where.every((w) => row[w.field] === w.value)) ?? null),
    findMany: () => Promise.resolve([...rows]),
    delete: ({ where }: { where: { field: string; value: unknown }[] }) => {
      const i = rows.findIndex((row) => where.every((w) => row[w.field] === w.value));
      if (i >= 0) rows.splice(i, 1);
      return Promise.resolve();
    },
  } as unknown as Inner;
  const factory: Factory = () => adapter;
  return { rows, adapter: withHashedSessionTokens(factory)({}) };
}

describe('withHashedSessionTokens', () => {
  it('stores the SHA-256 of the token but returns the original to Better Auth', async () => {
    const { rows, adapter } = fakeAdapter();
    const created = await adapter.create<Row>({
      model: 'session',
      data: { token: 'plain-token', userId: 'u1' },
    });
    expect(created.token).toBe('plain-token');
    expect(rows[0]?.token).toBe(hashSessionToken('plain-token'));
    expect(JSON.stringify(rows)).not.toContain('plain-token');
  });

  it('finds a session by the plaintext token and gives the plaintext back', async () => {
    const { adapter } = fakeAdapter();
    await adapter.create({ model: 'session', data: { token: 'plain-token' } });
    const found = await adapter.findOne<Row>({
      model: 'session',
      where: [{ field: 'token', value: 'plain-token' }],
    });
    expect(found?.token).toBe('plain-token');
    expect(
      await adapter.findOne({ model: 'session', where: [{ field: 'token', value: 'other' }] }),
    ).toBeNull();
  });

  it('does not accept the stored hash as a credential', async () => {
    const { adapter } = fakeAdapter();
    await adapter.create({ model: 'session', data: { token: 'plain-token' } });
    expect(
      await adapter.findOne({
        model: 'session',
        where: [{ field: 'token', value: hashSessionToken('plain-token') }],
      }),
    ).toBeNull();
  });

  it('leaves other models untouched', async () => {
    const { rows, adapter } = fakeAdapter();
    await adapter.create({ model: 'verification', data: { token: 'plain' } });
    expect(rows[0]?.token).toBe('plain');
  });

  it('deletes by plaintext token', async () => {
    const { rows, adapter } = fakeAdapter();
    await adapter.create({ model: 'session', data: { token: 'plain-token' } });
    await adapter.delete({ model: 'session', where: [{ field: 'token', value: 'plain-token' }] });
    expect(rows).toHaveLength(0);
  });
});
