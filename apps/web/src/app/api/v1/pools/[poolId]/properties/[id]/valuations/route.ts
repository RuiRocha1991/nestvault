import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertiesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

type Params = { poolId: string; id: string };

// The valuations of a property, newest first.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(
    await (await getPropertiesService()).listValuations(req.headers, poolId, id),
  );
});

// Adds a valuation (`realestate.write`, Pro); one per day.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getPropertiesService()).addValuation(req.headers, poolId, id, body),
    { status: 201 },
  );
});
