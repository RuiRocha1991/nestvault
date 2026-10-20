import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getCashMovesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

type Params = { poolId: string; id: string };

// The cash moves of a portfolio, newest first. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getCashMovesService()).list(req.headers, poolId, id));
});

// Moves cash from the portfolio to a bank account (`ops.write`: members too), with or without the mirror movement. Strict body: the pool and the portfolio come from the URL.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getCashMovesService()).create(req.headers, poolId, id, body),
    { status: 201 },
  );
});
