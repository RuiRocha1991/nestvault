import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPortfoliosService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The domain summary (value, gain, dividends, cash, profit, IRR…) of one portfolio (`portfolioId`)
// or of all, as of a date. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getPortfoliosService()).summary(req.headers, poolId, query),
  );
});
