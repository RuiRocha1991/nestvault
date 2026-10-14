import { ValidationError } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

export const GET = route(async (req, ctx) => {
  await signedIn(req, ctx);
  return NextResponse.json(await (await getAccountService()).listSessions(req.headers));
});

// Ends every session of the user except the one making the request. `?others=true` is required, so
// that a bare DELETE can never be mistaken for "end everything".
export const DELETE = route(async (req, ctx) => {
  await signedIn(req, ctx);
  if (new URL(req.url).searchParams.get('others') !== 'true') {
    throw new ValidationError('Pass others=true to end the other sessions.');
  }
  return NextResponse.json(await (await getAccountService()).revokeOtherSessions(req.headers));
});
