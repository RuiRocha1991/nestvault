import { auditLogRepo } from '@nestvault/db';
import type { AuditCriteria, IdentityDatabase, PoolContext } from '@nestvault/db';
import { z } from 'zod';

import { maskIp } from '../account/mask-ip';
import { ValidationError } from '../errors';
import { can } from '../guards';

import { actionsOfCategory, AUDIT_ACTIONS, AUDIT_CATEGORIES } from './actions';

export const AUDIT_PAGE_MAX = 100;

/** `<iso time>|<uuid>` of the last entry of a page: a keyset cursor, stable when times tie. */
const CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/i;
const parseCursor = (cursor: string) => {
  const [at = '', id = ''] = cursor.split('|');
  return { at: new Date(at), id };
};

/** Rows past which a page number is refused: deep paging is a scan, and nobody reads that far. */
const PAGE_MAX = 10_000;

export const AuditQuery = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional(),
    category: z.enum(AUDIT_CATEGORIES).optional(),
    userId: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    before: z.string().regex(CURSOR).optional(),
    /** 1-based page number; an alternative to the `before` cursor, not combinable with it. */
    page: z.coerce.number().int().min(1).max(PAGE_MAX).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(50),
  })
  .strict()
  .refine((query) => !(query.action && query.category), 'action and category exclude each other')
  .refine((query) => !(query.page && query.before), 'page and before exclude each other');
export type AuditQuery = z.input<typeof AuditQuery>;

/** The part of a query that chooses entries (shared by the listing and the count). */
export const criteriaOf = (query: z.infer<typeof AuditQuery>): AuditCriteria => ({
  ...(query.action ? { action: query.action } : {}),
  ...(query.category ? { actions: actionsOfCategory(query.category) } : {}),
  ...(query.userId ? { userId: query.userId } : {}),
  ...(query.from ? { from: new Date(query.from) } : {}),
  ...(query.to ? { to: new Date(query.to) } : {}),
});

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
    ...criteriaOf(query),
    limit: query.limit + 1,
    ...(query.page ? { offset: (query.page - 1) * query.limit } : {}),
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
