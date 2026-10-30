import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getLoansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string };

// Links every unlinked installment to the debit of the loan's account that matches its total (± a few cents) within a few days (`realestate.write`, Pro). No body.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getLoansService()).matchInstallments(req.headers, poolId, id));
});
