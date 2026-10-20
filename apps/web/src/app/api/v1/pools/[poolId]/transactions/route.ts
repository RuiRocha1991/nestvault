import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getTransactionsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

// A page of the pool's movements: filters (month, account, category, kind, text, with notes), an
// allow-listed sort and a keyset cursor, all in the query string. Guards (in the service): session,
// membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getTransactionsService()).list(req.headers, poolId, query));
});

// Records a movement by hand; the rules and the transfer detection run after it. Strict body: the
// pool comes from the URL. Needs `transactions.write` (members too).
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getTransactionsService()).create(req.headers, poolId, body),
    {
      status: 201,
    },
  );
});
