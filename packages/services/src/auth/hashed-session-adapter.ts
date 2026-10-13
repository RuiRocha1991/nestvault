import { createHash } from 'node:crypto';

import type { DBAdapter, DBAdapterInstance, Where } from 'better-auth';

/** SHA-256 hex of a session token: what the database stores instead of the token itself. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type Row = Record<string, unknown>;

const isTokenFilter = (where: Where) => where.field === 'token';

function hashWhere(where: Where[] | undefined): Where[] | undefined {
  return where?.map((clause) => {
    if (!isTokenFilter(clause)) return clause;
    const hashValue = <V>(v: V) => (typeof v === 'string' ? hashSessionToken(v) : v);
    const value = Array.isArray(clause.value)
      ? clause.value.map(hashValue)
      : hashValue(clause.value);
    return { ...clause, value } as Where;
  });
}

/** The plaintext token when the lookup was an exact match on one, so the row can be restored. */
function plaintextTokenOf(where: Where[] | undefined): string | undefined {
  const clause = where?.find((w) => isTokenFilter(w) && (w.operator ?? 'eq') === 'eq');
  return typeof clause?.value === 'string' ? clause.value : undefined;
}

function restore<T>(row: T | null, token: string | undefined): T | null {
  if (row === null || token === undefined) return row;
  return { ...(row as Row), token } as T;
}

function wrapSessionOps(adapter: DBAdapter): DBAdapter {
  const forSession = <A extends { model: string; where?: Where[] | undefined }>(args: A): A =>
    args.model === 'session' && args.where ? { ...args, where: hashWhere(args.where) } : args;

  return {
    ...adapter,
    async create(args) {
      if (args.model !== 'session') return adapter.create(args);
      const data = args.data as Row;
      const token = data.token;
      if (typeof token !== 'string') return adapter.create(args);
      const created = await adapter.create({
        ...args,
        data: { ...data, token: hashSessionToken(token) },
      });
      // Better Auth puts `created.token` in the cookie, so it must be the original value.
      return restore(created, token) as never;
    },
    async findOne(args) {
      const row = await adapter.findOne(forSession(args));
      return args.model === 'session' ? restore(row, plaintextTokenOf(args.where)) : row;
    },
    findMany: (args) => adapter.findMany(forSession(args)),
    count: (args) => adapter.count(forSession(args)),
    async update(args) {
      const row = await adapter.update(forSession(args));
      return args.model === 'session' ? restore(row, plaintextTokenOf(args.where)) : row;
    },
    updateMany: (args) => adapter.updateMany(forSession(args)),
    delete: (args) => adapter.delete(forSession(args)),
    deleteMany: (args) => adapter.deleteMany(forSession(args)),
    async consumeOne(args) {
      const row = await adapter.consumeOne(forSession(args));
      return args.model === 'session' ? restore(row, plaintextTokenOf(args.where)) : row;
    },
    incrementOne: (args) => adapter.incrementOne(forSession(args)),
    transaction: (callback) =>
      adapter.transaction((trx) => callback(wrapSessionOps(trx as DBAdapter) as never)),
  } as DBAdapter;
}

/**
 * Makes the `session.token` column hold only a SHA-256 of the cookie token (a database leak cannot
 * be replayed as a login). Better Auth keeps working with the plaintext: it is hashed on every
 * lookup and restored on the rows returned for an exact-token query. Rows from `findMany` carry the
 * stored hash, which is useless as a credential; revoke those by session id, not by token.
 */
export function withHashedSessionTokens(inner: DBAdapterInstance): DBAdapterInstance {
  return (options) => wrapSessionOps(inner(options));
}
