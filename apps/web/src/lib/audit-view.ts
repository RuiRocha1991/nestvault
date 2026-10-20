import type { AuditEntryDto } from '@nestvault/services';

export type AuditEntryView = AuditEntryDto;

/** The actions of one category, for the action filter's option groups. */
export interface AuditActionGroup {
  category: string;
  actions: readonly string[];
}

/** `member.role_changed` → category `member`, message key `roleChanged`. */
export function splitAction(code: string): { category: string; name: string } {
  const [category = '', rest = ''] = code.split('.');
  return { category, name: rest.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) };
}

/** Chip tone per category; a lookup, not logic. A failed sign-in is always `warn`. */
export const CATEGORY_TONE: Readonly<Record<string, 'default' | 'accent' | 'pos' | 'warn'>> = {
  auth: 'default',
  session: 'default',
  pool: 'accent',
  member: 'warn',
  invite: 'pos',
  holder: 'default',
  account: 'default',
  asset: 'default',
  category: 'default',
  transaction: 'default',
  rule: 'default',
  portfolio: 'default',
  op: 'default',
  plan: 'default',
  cashmove: 'default',
  product: 'default',
  deposit: 'default',
  interest: 'default',
  note: 'default',
  settings: 'default',
};

export const FAILED_SIGN_IN = 'auth.signin_failed';

/** Data colours (CSS variables from the tokens) for the avatars, picked by the person's id. */
const AVATAR_COLORS = [
  'var(--c-orange)',
  'var(--c-violet)',
  'var(--c-green)',
  'var(--c-blue)',
  'var(--c-pink)',
  'var(--c-teal)',
] as const;

export function avatarColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** The first four characters of an id: enough to tell two invites apart on screen. */
export const shortCode = (id: string) => id.slice(0, 4);

/** `0192f3a1-…-…-c41e` → `0192f3a…c41e`, as in the detail panel. */
export const shortId = (id: string) => `${id.slice(0, 7)}…${id.slice(-4)}`;
