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

/**
 * The roles a member may hand out when inviting (PRD 01): never above their own, so an admin cannot
 * make an owner. Kept next to the role sets so no feature code compares role names.
 */
const ASSIGNABLE_ROLES: Readonly<Record<Role | 'system', ReadonlySet<Role>>> = {
  owner: new Set<Role>(['owner', 'admin', 'member', 'viewer']),
  admin: new Set<Role>(['admin', 'member', 'viewer']),
  member: new Set<Role>(),
  viewer: new Set<Role>(),
  system: new Set<Role>(), // background work never hands out roles
};

/** True when the caller may give `role` to somebody else. */
export function canAssignRole(ctx: PoolContext, role: Role): boolean {
  return ASSIGNABLE_ROLES[ctx.role].has(role);
}

/** Same as `canAssignRole` for a role read from the database (the caller's role under a lock). */
export function canAssignRoleAs(actor: Role, role: Role): boolean {
  return ASSIGNABLE_ROLES[actor].has(role);
}

/**
 * True for the roles that hold the pool itself, the ones that can hand it over: the owners. Asked
 * through the permission table so no feature code compares role names.
 */
export function holdsOwnerRights(role: Role): boolean {
  return ROLE_PERMISSIONS[role].has('pool.transfer');
}

/** How many of the members hold the pool. */
function countOwners(members: readonly { role: Role }[]): number {
  return members.filter((member) => holdsOwnerRights(member.role)).length;
}

/**
 * The roles a handover of the pool gives: the person who receives it becomes an owner and the
 * one who hands it over steps down to admin (unless they choose to stay an owner).
 */
export const HANDOVER_ROLES = { incoming: 'owner', outgoing: 'admin' } as const satisfies Record<
  string,
  Role
>;

/** True when two roles are the same one. */
export function sameRole(a: Role, b: Role): boolean {
  return a === b;
}

/**
 * Whether `actor` may change or remove `target` (PRD 01): they need `members.manage`, never act on
 * themselves (they leave, or the owner transfers the pool) and only an owner may touch an owner.
 */
export function canActOnMember(
  actor: { userId: string; role: Role },
  target: { userId: string; role: Role },
): boolean {
  if (actor.userId === target.userId) return false;
  const granted = ROLE_PERMISSIONS[actor.role];
  if (!granted.has('members.manage')) return false;
  return !holdsOwnerRights(target.role) || granted.has('pool.transfer');
}

/**
 * True when giving `target` the role `next` (`null` for removing them) would leave the pool without
 * an owner: a pool always has at least one.
 */
export function leavesNoOwner(
  members: readonly { userId: string; role: Role }[],
  target: { userId: string; role: Role },
  next: Role | null,
): boolean {
  if (!holdsOwnerRights(target.role)) return false;
  if (next !== null && holdsOwnerRights(next)) return false;
  return countOwners(members) < 2;
}

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
