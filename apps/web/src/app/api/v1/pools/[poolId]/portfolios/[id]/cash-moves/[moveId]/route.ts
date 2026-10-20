import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getCashMovesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

type Params = { poolId: string; id: string; moveId: string };

// Undoes a cash move; the mirror movement it created is deleted with it (`ops.write`).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id, moveId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getCashMovesService()).remove(req.headers, poolId, id, moveId);
  return new NextResponse(null, { status: 204 });
});
