import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotificationsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string };

// Marks one notification as read for the caller only; idempotent. Guards (in the service): session,
// id validation and membership (404), `pool.read`; a notification of another pool answers 404.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getNotificationsService()).markRead(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
