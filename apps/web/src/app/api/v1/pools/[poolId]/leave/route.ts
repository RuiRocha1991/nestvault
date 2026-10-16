import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getMembersService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The caller leaves the pool. It takes no body; the only owner cannot leave (409).
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getMembersService()).leave(req.headers, poolId);
  return new NextResponse(null, { status: 204 });
});
