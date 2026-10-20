import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getExpensesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Totals of the movements a Movimentos filter selects. Same filters as the movements list, without
// sort and paging. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getExpensesService()).totals(req.headers, poolId, query));
});
