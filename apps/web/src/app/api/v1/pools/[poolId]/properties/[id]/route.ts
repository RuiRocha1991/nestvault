import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPropertiesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8192;

type Params = { poolId: string; id: string };

// One property.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getPropertiesService()).get(req.headers, poolId, id));
});

// Changes a property; fields left out stay, `holders` replaces the owners (`realestate.write`, Pro).
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getPropertiesService()).update(req.headers, poolId, id, body),
  );
});

// Deletes a property with its owners and valuations (`realestate.write`, Pro).
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getPropertiesService()).remove(req.headers, poolId, id);
  return new NextResponse(null, { status: 204 });
});
