declare const poolContextBrand: unique symbol;

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** The role a stored string stands for, or `null` for anything else. */
export const parseRole = (value: unknown): Role | null =>
  ROLES.find((candidate) => candidate === value) ?? null;

/** Who is acting inside a pool: a signed-in member, or a worker job acting as the system. */
export type PoolActor =
  { readonly kind: 'user'; readonly userId: string } | { readonly kind: 'system' };

/**
 * Proof that the caller passed the guards (session → membership → permission) for one pool.
 *
 * Every `nestvault_app` repository takes one. It is opaque on purpose: the brand cannot be named
 * outside this file, so an object literal never satisfies the type, and only `requirePoolAccess`
 * in packages/services creates it (through `@nestvault/db/pool-context-factory`, which ESLint
 * restricts to services and tests).
 */
export interface PoolContext {
  readonly [poolContextBrand]: true;
  readonly poolId: string;
  readonly actor: PoolActor;
  readonly role: Role | 'system';
  readonly permissions: ReadonlySet<string>;
}
