import { ROLES, type InvitePreviewRow, type InviteRow } from '@nestvault/db';
import { z } from 'zod';

/** Only what the inviter chooses. The pool comes from the URL, the inviter from the session. */
export const CreateInviteInput = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: z.enum(ROLES),
  })
  .strict();
export type CreateInviteInput = z.input<typeof CreateInviteInput>;

/** A pending invite as the people who can invite see it. Never the token or its hash. */
export const InviteDto = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type InviteDto = z.infer<typeof InviteDto>;

export const InviteListDto = z.object({ invites: z.array(InviteDto) });
export type InviteListDto = z.infer<typeof InviteListDto>;

/** What the public invite page shows to whoever holds the link. */
export const InvitePreviewDto = z.object({
  poolName: z.string(),
  inviterName: z.string().nullable(),
  email: z.string(),
  role: z.enum(ROLES),
  expiresAt: z.iso.datetime(),
});
export type InvitePreviewDto = z.infer<typeof InvitePreviewDto>;

export const AcceptInviteDto = z.object({ poolId: z.uuid() });
export type AcceptInviteDto = z.infer<typeof AcceptInviteDto>;

export const toInviteDto = (row: InviteRow): InviteDto =>
  InviteDto.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });

export const toInvitePreviewDto = (row: InvitePreviewRow): InvitePreviewDto =>
  InvitePreviewDto.parse({
    poolName: row.poolName,
    inviterName: row.inviterName,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
  });
