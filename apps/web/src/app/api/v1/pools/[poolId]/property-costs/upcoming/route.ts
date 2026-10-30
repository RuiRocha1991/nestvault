import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertyCostsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string };

// The occurrences still expected, by month, for the month forecast; `?months=` (1–24, default 12). Insurances already inside a loan installment are left out (`pool.read`, Pro).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getPropertyCostsService()).upcoming(req.headers, poolId, query),
  );
});
