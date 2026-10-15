import { createHash, randomBytes } from 'node:crypto';

/** An invite is valid for seven days (PRD 01); the email and the invite page both say so. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 32 random bytes as base64url: 43 characters, 256 bits. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** False for anything that cannot be a token we issued, so it never reaches the database. */
export const isInviteTokenShape = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_SHAPE.test(value);

/** Only this hash is stored: a database leak does not give working links. */
export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** The page the email links to. The token is a path segment, never logged by the services. */
export const inviteLink = (appUrl: string, token: string): string =>
  `${appUrl}/convite/${encodeURIComponent(token)}`;
