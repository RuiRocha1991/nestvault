import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertyCostsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string; dueDate: string };

// Pays the occurrence due on `dueDate` with a bank debit (`realestate.write`, Pro).
export const PUT = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, dueDate } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getPropertyCostsService()).linkPayment(req.headers, poolId, id, dueDate, body),
  );
});

// Takes the link away; the occurrence is expected again (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, dueDate } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getPropertyCostsService()).unlinkPayment(req.headers, poolId, id, dueDate);
  return new NextResponse(null, { status: 204 });
});
