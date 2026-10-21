import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getOverviewService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Everything the overview screen shows, in one read. Guards (in the service): session, query
// validation (strict), membership (404), `pool.read`, then `withPool` (RLS). A read: no audit entry.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getOverviewService()).get(req.headers, poolId, query));
});
