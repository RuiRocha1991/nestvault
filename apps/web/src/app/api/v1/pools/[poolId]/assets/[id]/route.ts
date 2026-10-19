import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAssetsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

type Params = { poolId: string; id: string };

// One asset with its price on a day (any member).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getAssetsService()).get(req.headers, poolId, id, query));
});

// Changes an asset; fields left out stay. Needs `portfolios.write`.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getAssetsService()).update(req.headers, poolId, id, body));
});

// Deletes an asset and its prices; 409 while operations use it.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getAssetsService()).remove(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
