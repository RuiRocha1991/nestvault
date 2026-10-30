import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getEntitlementsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The pool's plan with its limits, usage and features. Guards (in the service): session,
// membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getEntitlementsService()).get(req.headers, poolId));
});
