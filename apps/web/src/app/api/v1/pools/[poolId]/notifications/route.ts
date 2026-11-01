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
  // A repeated key becomes an array, which the strict schema rejects (400); `Object.fromEntries`
  // would silently keep the last value.
  const params = new URL(req.url).searchParams;
  const query = Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );
  return NextResponse.json(
    await (await getNotificationsService()).list(req.headers, poolId, query),
  );
});
