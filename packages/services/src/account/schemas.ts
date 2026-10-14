import { z } from 'zod';

export const NAME_MAX_LENGTH = 120;

export const MeDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
});
export type MeDto = z.infer<typeof MeDto>;

export const UpdateProfileInput = z
  .object({ name: z.string().trim().min(1).max(NAME_MAX_LENGTH) })
  .strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/** A session of the signed-in user. No token, no token hash, no full IP address. */
export const SessionDto = z.object({
  id: z.uuid(),
  current: z.boolean(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  kind: z.enum(['desktop', 'mobile']),
  /** The address with its end hidden (`85.240.x.x`). */
  ipMasked: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Last time the session was renewed (at most once a day while it is used). */
  lastActiveAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type SessionDto = z.infer<typeof SessionDto>;

export const SessionListDto = z.object({ sessions: z.array(SessionDto) });
export type SessionListDto = z.infer<typeof SessionListDto>;

export const RevokedSessionsDto = z.object({ revoked: z.number().int().nonnegative() });
export type RevokedSessionsDto = z.infer<typeof RevokedSessionsDto>;
