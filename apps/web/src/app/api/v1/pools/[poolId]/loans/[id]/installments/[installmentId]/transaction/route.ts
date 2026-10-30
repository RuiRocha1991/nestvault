import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getLoansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

type Params = { poolId: string; id: string; installmentId: string };

// Marks an installment paid by a bank debit: only its interest, fees, taxes and insurances count as an expense, the capital as savings (`realestate.write`, Pro).
export const PUT = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, installmentId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getLoansService()).linkInstallment(req.headers, poolId, id, installmentId, body),
  );
});

// Takes the link away; the debit counts as a plain expense again (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, installmentId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getLoansService()).unlinkInstallment(req.headers, poolId, id, installmentId);
  return new NextResponse(null, { status: 204 });
});
