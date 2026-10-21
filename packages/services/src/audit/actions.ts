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
  'pool.renamed',
  'pool.prototype_imported',
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
  'holder.merged',
  'settings.updated',
  'account.created',
  'account.updated',
  'account.deleted',
  'account.sub_account_created',
  'account.sub_account_updated',
  'account.sub_account_deleted',
  'asset.created',
  'asset.updated',
  'asset.deleted',
  'asset.price_set',
  'asset.price_deleted',
  'asset.prices_imported',
  'category.created',
  'category.updated',
  'category.deleted',
  'category.settings_updated',
  'transaction.created',
  'transaction.updated',
  'transaction.deleted',
  'rule.created',
  'rule.updated',
  'rule.deleted',
  'rule.reordered',
  'rule.applied',
  'portfolio.created',
  'portfolio.updated',
  'portfolio.deleted',
  'op.created',
  'op.updated',
  'op.deleted',
  'plan.created',
  'plan.updated',
  'plan.deleted',
  'plan.run',
  'cashmove.created',
  'cashmove.deleted',
  'product.created',
  'product.updated',
  'product.deleted',
  'deposit.created',
  'deposit.updated',
  'deposit.deleted',
  'interest.created',
  'interest.deleted',
  'note.updated',
] as const;

export const AUDIT_ACTIONS = [...ACCOUNT_AUDIT_ACTIONS, ...POOL_AUDIT_ACTIONS] as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];
export type PoolAuditAction = (typeof POOL_AUDIT_ACTIONS)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The groups the audit screen filters by; an action belongs to the group of its prefix. */
export const AUDIT_CATEGORIES = [
  'auth',
  'session',
  'pool',
  'member',
  'invite',
  'holder',
  'settings',
  'account',
  'asset',
  'category',
  'transaction',
  'rule',
  'portfolio',
  'op',
  'plan',
  'cashmove',
  'product',
  'deposit',
  'interest',
  'note',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const actionsOfCategory = (category: AuditCategory): readonly AuditAction[] =>
  AUDIT_ACTIONS.filter((action) => action.startsWith(`${category}.`));
