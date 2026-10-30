import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getWorksService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string };

// The phases still to pay, by the month they are planned for (`pool.read`, Pro).
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getWorksService()).upcoming(req.headers, poolId));
});
