import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getDepositsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string };

// Interest payments, next payment, maturity and value of a deposit (`?asOf=yyyy-mm-dd`, today by
// default). Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getDepositsService()).schedule(req.headers, poolId, id, query),
  );
});
