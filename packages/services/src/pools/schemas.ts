import { ROLES, type PoolSummaryRow } from '@nestvault/db';
import { z } from 'zod';

export const POOL_NAME_MAX = 60;

/** 1-60 characters after trimming, no control characters (a name is shown in titles and menus). */
export const CreatePoolInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(POOL_NAME_MAX)
      // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
      .regex(/^[^\u0000-\u001f\u007f]+$/),
  })
  .strict();
export type CreatePoolInput = z.input<typeof CreatePoolInput>;

/** A pool as its member sees it. No other member, no email. */
export const PoolSummaryDto = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(ROLES),
  memberCount: z.number().int().positive(),
  /** The newest recorded activity of the pool, or its creation. */
  lastActivityAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type PoolSummaryDto = z.infer<typeof PoolSummaryDto>;

export const PoolListDto = z.object({
  pools: z.array(PoolSummaryDto),
  /** The pool the session worked in last, only while the user still belongs to it. */
  activePoolId: z.uuid().nullable(),
});
export type PoolListDto = z.infer<typeof PoolListDto>;

export const toPoolSummaryDto = (row: PoolSummaryRow): PoolSummaryDto =>
  PoolSummaryDto.parse({
    id: row.id,
    name: row.name,
    role: row.role,
    memberCount: row.memberCount,
    lastActivityAt: (row.lastEntryAt ?? row.createdAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
