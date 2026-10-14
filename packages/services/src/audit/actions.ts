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
] as const;

export const AUDIT_ACTIONS = [...ACCOUNT_AUDIT_ACTIONS, ...POOL_AUDIT_ACTIONS] as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];
export type PoolAuditAction = (typeof POOL_AUDIT_ACTIONS)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
