import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getMembersService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The pool's members. Guards (in the service): session, membership (404). Emails are only filled
// for callers with `members.manage`; everybody else sees names and roles.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getMembersService()).list(req.headers, poolId));
});
