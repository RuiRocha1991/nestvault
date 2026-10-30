import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getLoansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string };

// The pool's loans with their fields and what has been paid. Guards (in the service): session, membership (404), `pool.read`, then the Pro plan (403 `plan_limit`).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getLoansService()).list(req.headers, poolId));
});

// Creates a loan with the default fields (`realestate.write`, Pro). Strict body: the pool comes from the URL.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getLoansService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
