import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPoolsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// Creates a pool; the caller becomes its owner. There is no pool yet, so there is no membership or
// permission to check: the guards are the session, the strict body, the Origin check (in `route`)
// and the `api` rate limit. The owner is always the session user, never a field of the body.
export const POST = route(async (req, ctx) => {
  await signedIn(req, ctx);
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getPoolsService()).create(req.headers, body), {
    status: 201,
  });
});
