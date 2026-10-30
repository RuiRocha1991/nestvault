import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getWorksService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string; paymentId: string };

// Pays a phase with a bank debit: the phase takes the movement's date and the movement becomes "works" (`realestate.write`, Pro).
export const PUT = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, paymentId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getWorksService()).linkTransaction(req.headers, poolId, id, paymentId, body),
  );
});

// Takes the link away; the phase goes back to planned (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, paymentId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(
    await (await getWorksService()).unlinkTransaction(req.headers, poolId, id, paymentId),
  );
});
