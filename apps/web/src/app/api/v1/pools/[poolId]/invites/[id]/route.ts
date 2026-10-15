import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getInvitesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Cancels a pending invite of the pool. The id of an invite of another pool, an accepted one and an
// unknown one all answer 404.
export const DELETE = route<{ poolId: string; id: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getInvitesService()).cancel(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
