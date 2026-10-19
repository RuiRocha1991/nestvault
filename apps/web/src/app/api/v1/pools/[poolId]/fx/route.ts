import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getSettingsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The EUR rate of every currency for this pool on a day (`?asOf=yyyy-mm-dd`, today by default):
// the pool's override, else the newest market rate, else the seed. Any member may read it.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await (await getSettingsService()).fx(req.headers, poolId, query));
});
