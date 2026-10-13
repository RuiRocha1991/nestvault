// Test data factories shared by every package's tests. They build in-memory objects only: nothing
// here touches a database, so unit tests (services with mocked repositories) can use them too.
// Persisting a user and signing in arrive with Better Auth (NES-19), which owns those tables.
import { newId } from '@nestvault/db';
import type { PoolContext, Role } from '@nestvault/db';
import { createPoolContext } from '@nestvault/db/pool-context-factory';

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

/** A user with a unique id and a unique `@example.test` address. */
export function createUser(overrides: Partial<TestUser> = {}): TestUser {
  // Derived from the id, so it is unique across workers and runs, not only inside this module.
  const id = newId();
  return { id, email: `user-${id}@example.test`, name: `Test User ${id.slice(-8)}`, ...overrides };
}

export interface TestPool {
  poolId: string;
  /** The user that owns the pool. */
  owner: TestUser;
}

/** A pool with its owner. Members are added with `asMember`. */
export function createPool(owner: TestUser = createUser()): TestPool {
  return { poolId: newId(), owner };
}

/**
 * The `PoolContext` a request of `user` in `pool` would have with `role`. The permission names come
 * from the caller until the real role -> permission sets exist (NES-25).
 */
export function asMember(
  pool: Pick<TestPool, 'poolId'>,
  role: Role,
  options: { user?: TestUser; permissions?: readonly string[] } = {},
): PoolContext {
  const user = options.user ?? createUser();
  return createPoolContext({
    poolId: pool.poolId,
    actor: { kind: 'user', userId: user.id },
    role,
    permissions: options.permissions ?? [],
  });
}

/** Context for background work that acts on behalf of the system (imports, jobs). */
export function asSystem(pool: Pick<TestPool, 'poolId'>): PoolContext {
  return createPoolContext({
    poolId: pool.poolId,
    actor: { kind: 'system' },
    role: 'system',
    permissions: [],
  });
}
