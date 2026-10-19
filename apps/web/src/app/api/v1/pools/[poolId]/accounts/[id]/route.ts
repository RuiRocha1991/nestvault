import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

type Params = { poolId: string; id: string };

// One account with its balance today (any member).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getAccountsService()).get(req.headers, poolId, id));
});

// Changes an account; fields left out stay. Strict body, the pool and the id come from the URL.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getAccountsService()).update(req.headers, poolId, id, body),
  );
});

// Deletes an account; 409 while it has movements.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getAccountsService()).remove(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
