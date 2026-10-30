import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getWorksService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string; paymentId: string };

// Corrects a phase (`realestate.write`, Pro).
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, paymentId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getWorksService()).updatePayment(req.headers, poolId, id, paymentId, body),
  );
});

// Deletes a phase (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, paymentId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getWorksService()).removePayment(req.headers, poolId, id, paymentId);
  return new NextResponse(null, { status: 204 });
});
