import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPlansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// Regular investment plans, optionally of one portfolio. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getPlansService()).list(req.headers, poolId, query));
});

// Creates a plan (`portfolios.write`). Strict body: the pool comes from the URL.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getPlansService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
