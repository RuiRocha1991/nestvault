import type { AuditMeta } from '@nestvault/db';

/**
 * The only keys an audit entry may carry. Anything else is dropped, so a caller cannot put an
 * amount, an IBAN, a note, an email or a token in the log by accident.
 */
export const ALLOWED_META_KEYS = [
  'role',
  'previousRole',
  'actorRole',
  'targetUserId',
  'inviteId',
  'sessionId',
  'count',
  'reason',
] as const;

const ALLOWED = new Set<string>(ALLOWED_META_KEYS);

/** Identifiers and short codes only: no spaces, no `@`, so free text and addresses never fit. */
const SAFE_TEXT = /^[A-Za-z0-9_.:-]{1,80}$/;

export const isSafeAuditText = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_TEXT.test(value);

/** Keeps the allow-listed keys whose values are short codes, finite numbers or booleans. */
export function sanitizeAuditMeta(meta: unknown): AuditMeta {
  const clean: AuditMeta = {};
  if (typeof meta !== 'object' || meta === null) return clean;
  for (const [key, value] of Object.entries(meta)) {
    if (!ALLOWED.has(key)) continue;
    const scalar =
      typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (scalar || isSafeAuditText(value)) clean[key] = value;
  }
  return clean;
}
