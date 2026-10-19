import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getRulesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// The pool's keyword rules in the order they are tried. Any member.
export const GET = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(await (await getRulesService()).list(req.headers, poolId));
});

// Adds a rule after the last. Strict body; its category is global or the pool's own. Needs
// `categories.write`.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(await (await getRulesService()).create(req.headers, poolId, body), {
    status: 201,
  });
});
