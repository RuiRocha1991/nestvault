import { auditLogRepo, poolMembersRepo, usersRepo } from '@nestvault/db';
import type { IdentityDatabase, PoolContext } from '@nestvault/db';
import { z } from 'zod';

import { ValidationError } from '../errors';
import { can } from '../guards';

import { AuditPageDto, AuditQuery, criteriaOf, listAuditLog } from './list';

const PersonDto = z.object({ id: z.uuid(), name: z.string() });

/** What the audit screen needs in one go: a page, the match count and the names to show. */
export const AuditScreenDto = z.object({
  page: AuditPageDto,
  /** Entries matching the filters, across all pages. */
  total: z.number().int().nonnegative(),
  /** Names of every user an entry of the page refers to (actor or target), including ex-members. */
  people: z.array(PersonDto),
  /** The current members, for the person filter. */
  members: z.array(PersonDto),
});
export type AuditScreenDto = z.infer<typeof AuditScreenDto>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The audit screen's data. Same guards as `listAuditLog` (validation, then `audit.read`, owner
 * only); the names are looked up only for ids that appear on the page, so no other user is named.
 */
export async function listAuditScreen(
  identity: IdentityDatabase,
  ctx: PoolContext,
  rawQuery: unknown,
): Promise<AuditScreenDto> {
  const parsed = AuditQuery.safeParse(rawQuery ?? {});
  if (!parsed.success) throw new ValidationError();
  can(ctx, 'audit.read');
  const [page, total, members] = await Promise.all([
    listAuditLog(identity, ctx, parsed.data),
    auditLogRepo.countForPool(identity.db, ctx.poolId, criteriaOf(parsed.data)),
    poolMembersRepo.listWithNames(identity.db, ctx.poolId),
  ]);
  const ids = new Set<string>();
  for (const entry of page.entries) {
    for (const id of [entry.userId, entry.target, entry.meta.targetUserId]) {
      if (typeof id === 'string' && UUID.test(id)) ids.add(id.toLowerCase());
    }
  }
  const people = await usersRepo.namesByIds(identity.db, [...ids]);
  return AuditScreenDto.parse({
    page,
    total,
    people,
    members: members.map((member) => ({ id: member.userId, name: member.name })),
  });
}
