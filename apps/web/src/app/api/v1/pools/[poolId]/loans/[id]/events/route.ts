import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getLoansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string };

// The events of a loan in the order they take effect, each with what it did to the installment and the term.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getLoansService()).listEvents(req.headers, poolId, id));
});

// Records a prepayment, a rate review or a renegotiation (`realestate.write`, Pro).
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getLoansService()).addEvent(req.headers, poolId, id, body),
    { status: 201 },
  );
});
