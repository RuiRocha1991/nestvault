import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPlansService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256;

type Params = { poolId: string; id: string };

// Registers the plan's buy for a month (the current one by default). Idempotent per month: a
// second run (body `{}` or `{ "month": "yyyy-mm" }`) returns the existing buy with `created: false`. Needs `ops.write`.
export const POST = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  const run = await (await getPlansService()).run(req.headers, poolId, id, body);
  return NextResponse.json(run, { status: run.created ? 201 : 200 });
});
