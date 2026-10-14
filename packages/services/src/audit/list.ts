import { auditLogRepo } from '@nestvault/db';
import type { IdentityDatabase, PoolContext } from '@nestvault/db';
import { z } from 'zod';

import { maskIp } from '../account/mask-ip';
import { ValidationError } from '../errors';
import { can } from '../guards';

import { AUDIT_ACTIONS } from './actions';

export const AUDIT_PAGE_MAX = 100;

/** `<iso time>|<uuid>` of the last entry of a page: a keyset cursor, stable when times tie. */
const CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/i;
const parseCursor = (cursor: string) => {
  const [at = '', id = ''] = cursor.split('|');
  return { at: new Date(at), id };
};

export const AuditQuery = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    before: z.string().regex(CURSOR).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(50),
  })
  .strict();
export type AuditQuery = z.input<typeof AuditQuery>;

export const AuditEntryDto = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  /** Plain string: the table is insert-only, so rows of an action removed later must still list. */
  action: z.string(),
  target: z.string().nullable(),
  /** The address with its end hidden. */
  ipMasked: z.string().nullable(),
  at: z.iso.datetime(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;

export const AuditPageDto = z.object({
  entries: z.array(AuditEntryDto),
  /** Pass as `before` to get the next, older page; null on the last page. */
  nextBefore: z.string().nullable(),
});
export type AuditPageDto = z.infer<typeof AuditPageDto>;

/**
 * The pool's audit log, newest first. Guards in order: input validation, permission (the pool
 * access was already checked when the `PoolContext` was made). Only the owner holds `audit.read`.
 */
export async function listAuditLog(
  identity: IdentityDatabase,
  ctx: PoolContext,
  rawQuery: unknown,
): Promise<AuditPageDto> {
  const parsed = AuditQuery.safeParse(rawQuery ?? {});
  if (!parsed.success) throw new ValidationError();
  can(ctx, 'audit.read');
  const query = parsed.data;
  const rows = await auditLogRepo.listForPool(identity.db, ctx.poolId, {
    limit: query.limit + 1,
    ...(query.action ? { action: query.action } : {}),
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
    ...(query.before ? { before: parseCursor(query.before) } : {}),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return AuditPageDto.parse({
    entries: page.map((row) => ({
      id: row.id,
      userId: row.userId,
      action: row.action,
      target: row.target,
      ipMasked: maskIp(row.ip),
      at: row.at.toISOString(),
      meta: row.meta,
    })),
    nextBefore: rows.length > query.limit && last ? `${last.at.toISOString()}|${last.id}` : null,
  });
}
