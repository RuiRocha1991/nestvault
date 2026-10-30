import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertiesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8192;

// Properties with owners and latest valuation. Guards (in the service): session, membership (404),
// `pool.read`, then the Pro plan (403 `plan_limit`).
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getPropertiesService()).list(req.headers, poolId));
});

// Registers a property (`realestate.write`, Pro). Strict body: the pool comes from the URL.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getPropertiesService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
