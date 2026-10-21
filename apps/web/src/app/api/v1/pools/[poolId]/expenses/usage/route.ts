import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getExpensesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// How many movements each category holds and each rule matches (the counts of the categories and
// rules screen). Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getExpensesService()).usage(req.headers, poolId));
});
