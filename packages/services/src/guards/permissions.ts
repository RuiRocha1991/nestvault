import type { PoolContext, Role } from '@nestvault/db';

// The permission catalogue and the role -> permission sets (PRD 01, "Roles in v1"). This is the only
// module that knows role names: feature code asks `can(ctx, 'accounts.write')`, never `role ===`
// (ESLint enforces it). Fine-grained rules per account or portfolio (`member_rules`, phase 4) will
// extend `can` through its `resource` argument without touching callers.

export const PERMISSIONS = [
  'pool.read',
  'pool.export',
  'pool.delete',
  'pool.transfer',
  'members.invite',
  'members.manage',
  'accounts.write',
  'portfolios.write',
  'categories.write',
  'goals.write',
  'transactions.write',
  'ops.write',
  'prices.write',
  'notes.write',
  'imports.run',
  'settings.write',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MEMBER: readonly Permission[] = [
  'pool.read',
  'transactions.write',
  'ops.write',
  'prices.write',
  'notes.write',
  'imports.run',
];

const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'accounts.write',
  'portfolios.write',
  'categories.write',
  'goals.write',
  'members.invite',
  'members.manage', // admins cannot touch owners: enforced by the members service (NES-28)
  'settings.write',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
  viewer: new Set<Permission>(['pool.read']),
};

/** The permissions a role grants. */
export function permissionsOfRole(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

/**
 * The permissions of the caller in this pool, for pages that hide actions the user cannot do.
 * Hiding is cosmetic: the service-layer `can` check is the real one.
 */
export function permissionsFor(ctx: PoolContext): ReadonlySet<Permission> {
  return new Set(PERMISSIONS.filter((permission) => ctx.permissions.has(permission)));
}
