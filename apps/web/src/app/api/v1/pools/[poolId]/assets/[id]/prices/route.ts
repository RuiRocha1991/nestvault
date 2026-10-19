import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAssetsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512;

type Params = { poolId: string; id: string };

// The price history of an asset, newest first (`?from`, `?to`, `?limit`). Any member.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getAssetsService()).prices(req.headers, poolId, id, query));
});

// Adds the price of a day or replaces it. Needs `prices.write` (members too).
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getAssetsService()).setPrice(req.headers, poolId, id, body),
  );
});
