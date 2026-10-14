import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024;

// The signed-in user's own profile. Outside every pool: it belongs to the user, not to a household.
export const GET = route(async (req, ctx) => {
  await signedIn(req, ctx);
  return NextResponse.json(await (await getAccountService()).getMe(req.headers));
});

// Only the name can change here. The email changes through /auth/change-email (needs the new
// address to confirm it); the body is strict, so nothing else gets through.
export const PATCH = route(async (req, ctx) => {
  await signedIn(req, ctx);
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getAccountService()).updateProfile(req.headers, body));
});
