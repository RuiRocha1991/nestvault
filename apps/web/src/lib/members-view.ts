import type { InviteDto, MemberDto } from '@nestvault/services';

import type { Capability } from '@webapp/lib/role-capabilities';

/** A member and a pending invite as the members screen receives them (DTOs of the services). */
export type MemberView = MemberDto;
export type InviteView = InviteDto;
export type RoleName = MemberDto['role'];

/** What each role can do, computed on the server from its permission set (the client never sees permissions). */
export type RoleCapabilities = Readonly<Record<RoleName, readonly Capability[]>>;

/** The roles the screen hands out. Owner is made by transferring the pool, never by a select. */
export const ASSIGNABLE_ROLES = [
  'admin',
  'member',
  'viewer',
] as const satisfies readonly RoleName[];
