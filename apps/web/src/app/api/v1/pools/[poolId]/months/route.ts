import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The month notes between `from` and `to` (`yyyy-mm`, at most 120 months) for the timeline.
// Guards (in the service): session, zod, membership (404), `pool.read`.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(
    await (await getNotesService()).listMonthNotes(req.headers, poolId, query),
  );
});
