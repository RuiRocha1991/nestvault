import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertyCostsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string };

// What the properties cost in a period (`?propertyId=&from=&to=`, default the current year), with the installment insurances counted once (`pool.read`, Pro).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getPropertyCostsService()).totals(req.headers, poolId, query),
  );
});
