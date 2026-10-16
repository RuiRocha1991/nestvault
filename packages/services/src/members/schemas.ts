import { ROLES, type MemberRow, type Role } from '@nestvault/db';
import { z } from 'zod';

import { PASSWORD_MAX_LENGTH } from '../auth/password-policy';
import { canActOnMember, holdsOwnerRights } from '../guards/permissions';

/**
 * A role change carries the new role; the pool and the member come from the URL. Making somebody an
 * owner also needs the caller's password (same as handing the pool over); for any other role the
 * password is not read.
 */
export const UpdateMemberRoleInput = z
  .object({ role: z.enum(ROLES), password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional() })
  .strict();
export type UpdateMemberRoleInput = z.input<typeof UpdateMemberRoleInput>;

/**
 * Handing the pool over: who gets it, the caller's password (a stolen session cannot give a pool
 * away) and whether the caller stays an owner too (by default they become an admin).
 */
export const TransferOwnershipInput = z
  .object({
    userId: z.uuid(),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    keepOwnership: z.boolean().optional(),
  })
  .strict();
export type TransferOwnershipInput = z.input<typeof TransferOwnershipInput>;

/** A member as the pool's people see them. `email` is only filled for those who manage members. */
export const MemberDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  role: z.enum(ROLES),
  joinedAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime().nullable(),
  /** True for the caller's own row. */
  isYou: z.boolean(),
  /** True when this person holds the pool (an owner). */
  owner: z.boolean(),
  /** True when the caller may change this person's role or remove them (a hint for the screen). */
  editable: z.boolean(),
});
export type MemberDto = z.infer<typeof MemberDto>;

export const MemberListDto = z.object({ members: z.array(MemberDto) });
export type MemberListDto = z.infer<typeof MemberListDto>;

export const MemberRoleDto = z.object({ id: z.uuid(), role: z.enum(ROLES) });
export type MemberRoleDto = z.infer<typeof MemberRoleDto>;

/** The caller's role after a transfer. */
export const TransferOwnershipDto = z.object({ poolId: z.uuid(), role: z.enum(ROLES) });
export type TransferOwnershipDto = z.infer<typeof TransferOwnershipDto>;

export const toMemberDto = (
  row: MemberRow,
  viewer: { userId: string; role: Role },
  showEmail: boolean,
): MemberDto =>
  MemberDto.parse({
    id: row.userId,
    name: row.name,
    email: showEmail ? row.email : null,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    isYou: row.userId === viewer.userId,
    owner: holdsOwnerRights(row.role),
    editable: canActOnMember(viewer, { userId: row.userId, role: row.role }),
  });
