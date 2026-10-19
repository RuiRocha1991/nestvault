/** Actions about one account, outside any pool (sign-in, passwords, sessions). */
export const ACCOUNT_AUDIT_ACTIONS = [
  'auth.signin',
  'auth.signin_failed',
  'auth.password_changed',
  'session.revoked',
] as const;

/** Actions inside a pool; the pool and the actor come from the `PoolContext`. */
export const POOL_AUDIT_ACTIONS = [
  'pool.created',
  'member.role_changed',
  'member.removed',
  'member.left',
  'pool.ownership_transferred',
  'invite.created',
  'invite.cancelled',
  'invite.accepted',
  'holder.created',
  'holder.updated',
  'holder.deleted',
] as const;

export const AUDIT_ACTIONS = [...ACCOUNT_AUDIT_ACTIONS, ...POOL_AUDIT_ACTIONS] as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];
export type PoolAuditAction = (typeof POOL_AUDIT_ACTIONS)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The groups the audit screen filters by; an action belongs to the group of its prefix. */
export const AUDIT_CATEGORIES = ['auth', 'session', 'pool', 'member', 'invite', 'holder'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const actionsOfCategory = (category: AuditCategory): readonly AuditAction[] =>
  AUDIT_ACTIONS.filter((action) => action.startsWith(`${category}.`));
