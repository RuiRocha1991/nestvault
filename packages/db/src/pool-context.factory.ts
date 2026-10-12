// The ONLY place that builds a PoolContext. Import it from packages/services (requirePoolAccess)
// and from tests; ESLint rejects any other importer.
import { isUuidV7 } from './ids';
import type { PoolActor, PoolContext, Role } from './pool-context';
import { ROLES } from './pool-context';

export interface PoolContextInput {
  poolId: string;
  actor: PoolActor;
  role: Role | 'system';
  permissions: Iterable<string>;
}

/** A Set that stays what it was when the context was built: add, delete and clear throw. */
class FrozenPermissions extends Set<string> {
  constructor(items: Iterable<string>) {
    super();
    for (const item of items) super.add(item);
  }

  override add(): never {
    throw new TypeError('PoolContext.permissions is read-only');
  }

  override delete(): never {
    throw new TypeError('PoolContext.permissions is read-only');
  }

  override clear(): never {
    throw new TypeError('PoolContext.permissions is read-only');
  }
}

export function createPoolContext(input: PoolContextInput): PoolContext {
  if (!isUuidV7(input.poolId)) throw new TypeError('poolId must be a UUID v7');
  if (input.actor.kind === 'user' && !isUuidV7(input.actor.userId)) {
    throw new TypeError('userId must be a UUID v7');
  }
  if (input.role !== 'system' && !ROLES.includes(input.role)) {
    throw new TypeError('role is not a known role');
  }
  if (input.role === 'system' && input.actor.kind !== 'system') {
    throw new TypeError('the system role belongs to the system actor');
  }
  const context = {
    poolId: input.poolId.toLowerCase(),
    actor: Object.freeze(
      input.actor.kind === 'user'
        ? { kind: 'user' as const, userId: input.actor.userId.toLowerCase() }
        : { kind: 'system' as const },
    ),
    role: input.role,
    permissions: new FrozenPermissions(input.permissions),
  };
  return Object.freeze(context) as unknown as PoolContext;
}
