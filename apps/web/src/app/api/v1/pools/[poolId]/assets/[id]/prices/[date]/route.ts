import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAssetsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Removes the price of a day (`yyyy-mm-dd`). Needs `prices.write`.
export const DELETE = route<{ poolId: string; id: string; date: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, date } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getAssetsService()).removePrice(req.headers, poolId, id, date);
  return new NextResponse(null, { status: 204 });
});
