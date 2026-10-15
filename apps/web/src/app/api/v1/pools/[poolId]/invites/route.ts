import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getInvitesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// The pool's pending invites. Guards (in the service): session, membership (404), `members.invite` (403).
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getInvitesService()).listPending(req.headers, poolId));
});

// Invites somebody by email. The body is `{ email, role }` and nothing else (strict): the pool comes
// from the URL, the inviter from the session. The token only ever travels in the email.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getInvitesService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
