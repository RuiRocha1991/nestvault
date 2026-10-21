import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getExpensesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The Resumo of one month: income, expenses, savings rate, expenses by category with budget
// progress and the last twelve months. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getExpensesService()).summary(req.headers, poolId, query));
});
