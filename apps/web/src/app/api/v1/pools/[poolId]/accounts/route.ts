import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

// The accounts of the pool with their balance today. Guards (in the service): session, membership
// (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getAccountsService()).list(req.headers, poolId));
});

// Creates an account with its holders (and sub-accounts for a brokerage one). Strict body: the pool
// comes from the URL, never from the body. Needs `accounts.write`.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getAccountsService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
