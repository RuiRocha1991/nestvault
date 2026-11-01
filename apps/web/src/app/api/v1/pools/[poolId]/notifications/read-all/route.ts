import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotificationsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Marks every open notification of the pool as read for the caller only. Guards (in the service):
// session, membership (404), `pool.read`. The Origin check of write routes is in `route()`.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(
    await (await getNotificationsService()).markAllRead(req.headers, poolId),
  );
});
