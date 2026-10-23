import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; batchId: string };

// The preview of a pending import again; `?accountId=` shows it for another account (duplicates,
// categories and transfers are worked out for that account). `imports.run`.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, batchId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getImportsService()).get(req.headers, poolId, batchId, query),
  );
});

// Drops a pending import and its stored rows. 409 once it is committed or discarded.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, batchId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getImportsService()).discard(req.headers, poolId, batchId);
  return new NextResponse(null, { status: 204 });
});
