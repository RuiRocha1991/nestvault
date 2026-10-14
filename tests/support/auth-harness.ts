import type { sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import { usersRepo, type IdentityDatabase } from '@nestvault/db';
import type { Auth, MemoryEmailSender } from '@nestvault/services';

export const APP_URL = 'http://localhost:4000';
export const PASSWORD = 'a-long-unique-passphrase';
export const SECRET = 'x'.repeat(40);

/** POST to the Better Auth handler as the browser does (JSON body, same Origin). */
export const postAuth = (
  auth: Auth,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  appUrl = APP_URL,
) =>
  auth.handler(
    new Request(`${appUrl}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, ...headers },
      body: JSON.stringify(body),
    }),
  );

/** `name=value` of the session cookie a response set (empty when it set none). */
export const cookieOf = (response: Response) =>
  (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

/** Marks one account as verified, as using the emailed link would (sign-in needs it). */
export async function verifyEmail(identity: IdentityDatabase, email: string): Promise<void> {
  const id = await usersRepo.findIdByEmail(identity.db, email);
  if (!id) throw new Error('No such user to verify');
  await usersRepo.markEmailVerified(identity.db, id);
}

/** Signs up, checks the answer and (by default) confirms the address. */
export async function registerUser(
  auth: Auth,
  identity: IdentityDatabase,
  email: string,
  { verified = true, password = PASSWORD, name = 'Ana' } = {},
): Promise<void> {
  const res = await postAuth(auth, '/sign-up/email', { name, email, password });
  expect(res.status).toBe(200);
  if (verified) await verifyEmail(identity, email);
}

/** Waits for the `count`th email and returns it (the sender works in the background). */
export async function waitForMail(mail: MemoryEmailSender, count = 1) {
  await vi.waitFor(() => {
    expect(mail.sent.length).toBeGreaterThanOrEqual(count);
  });
  return mail.sent[count - 1] as (typeof mail.sent)[number];
}

/** The token of the first `APP_URL/<page>/<token>` link in an email body. */
export const tokenIn = (text: string, page: string) =>
  decodeURIComponent(new RegExp(`${APP_URL}/${page}/([^\\s"<]+)`).exec(text)?.[1] ?? '');

export async function rows<T extends Record<string, unknown> = Record<string, unknown>>(
  identity: IdentityDatabase,
  query: ReturnType<typeof sql>,
) {
  return (await identity.db.execute<T>(query)).rows;
}
