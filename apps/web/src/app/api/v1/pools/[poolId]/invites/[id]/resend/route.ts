import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getInvitesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Sends a pending invite again with a new link and a new 7-day expiry (the old link stops working).
// It takes no body: nothing about the invite can change here.
export const POST = route<{ poolId: string; id: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getInvitesService()).resend(req.headers, poolId, id));
});
