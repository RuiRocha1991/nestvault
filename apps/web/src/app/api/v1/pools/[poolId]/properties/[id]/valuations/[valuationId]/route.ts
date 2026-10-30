import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertiesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Deletes a valuation (`realestate.write`, Pro).
export const DELETE = route<{ poolId: string; id: string; valuationId: string }>(
  async (req, ctx) => {
    await signedIn(req, ctx);
    const { poolId, id, valuationId } = await ctx.params;
    ctx.setActor({ poolId });
    await (await getPropertiesService()).removeValuation(req.headers, poolId, id, valuationId);
    return new NextResponse(null, { status: 204 });
  },
);
