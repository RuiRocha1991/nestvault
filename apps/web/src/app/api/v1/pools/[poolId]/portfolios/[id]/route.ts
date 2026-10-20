import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPortfoliosService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string };

// One portfolio.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getPortfoliosService()).get(req.headers, poolId, id));
});

// Changes a portfolio; fields left out stay (`portfolios.write`).
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getPortfoliosService()).update(req.headers, poolId, id, body),
  );
});

// Deletes a portfolio. With operations or plans it needs `?moveTo=<portfolioId>` or `?deleteOps=true`, otherwise 409.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  await (await getPortfoliosService()).remove(req.headers, poolId, id, query);
  return new NextResponse(null, { status: 204 });
});
