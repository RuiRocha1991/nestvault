import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getHoldersService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

// The people of the household. Guards (in the service): session, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getHoldersService()).list(req.headers, poolId));
});

// Adds a person. The body is `{ name, color?, aliases?, userId? }` and nothing else (strict): the
// pool comes from the URL. Needs `accounts.write`.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getHoldersService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
