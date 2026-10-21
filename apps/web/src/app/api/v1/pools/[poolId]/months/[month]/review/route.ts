import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getMonthsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The monthly review of a month (`yyyy-mm`). Guards (in the service): session, zod (the month),
// membership (404), `pool.read`, then `withPool` (RLS). Read only: no audit entry.
export const GET = route<{ poolId: string; month: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, month } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getMonthsService()).review(req.headers, poolId, month));
});
