import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

type Params = { poolId: string; id: string; subId: string };

// Renames a sub-account or changes its holder; fields left out stay.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, subId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getAccountsService()).updateSubAccount(req.headers, poolId, id, subId, body),
  );
});

// Removes a sub-account; 409 while it has operations.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, subId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getAccountsService()).removeSubAccount(req.headers, poolId, id, subId);
  return new NextResponse(null, { status: 204 });
});
