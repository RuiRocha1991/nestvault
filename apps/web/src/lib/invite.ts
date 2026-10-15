import type { InvitePreviewDto } from '@nestvault/services';

/** The invite as the public pages receive it; components import this type, never the services root. */
export type InvitePreview = InvitePreviewDto;

/** Where an invite link lands. The token is a path segment; keep it out of any logged string. */
export const invitePath = (token: string) => `/convite/${encodeURIComponent(token)}`;
