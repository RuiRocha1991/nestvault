import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotificationsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The open notifications of the pool with the caller's own read state (`?status=all|unread`).
// Guards (in the service): session, zod, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getNotificationsService()).list(req.headers, poolId, query),
  );
});
