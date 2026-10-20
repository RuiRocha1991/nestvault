import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getInterestService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string };

// Deletes an interest entry (`accounts.write`).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getInterestService()).remove(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
