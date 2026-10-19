import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getCategoriesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

type Params = { poolId: string; id: string };

// Changes one of the pool's own categories; a global one answers 403. Needs `categories.write`.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getCategoriesService()).update(req.headers, poolId, id, body),
  );
});

// Deletes one of the pool's own categories (`?replacement=<id>` is where its transactions go); a
// global one answers 403.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const query = Object.fromEntries(new URL(req.url).searchParams);
  await (await getCategoriesService()).remove(req.headers, poolId, id, query);
  return new NextResponse(null, { status: 204 });
});
