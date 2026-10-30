import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getLoansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string; eventId: string };

// Deletes an event; the schedule goes back to what it was without it (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, eventId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getLoansService()).removeEvent(req.headers, poolId, id, eventId);
  return new NextResponse(null, { status: 204 });
});
