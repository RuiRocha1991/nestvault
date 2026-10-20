import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getTransactionsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512;

type Params = { poolId: string; id: string };

// Sets the category by hand (`null` hands it back to the rules) and/or fixes the transfer flag.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getTransactionsService()).update(req.headers, poolId, id, body),
  );
});

// Deletes a movement; the other side of its transfer is released.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getTransactionsService()).remove(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
