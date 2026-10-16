import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getMembersService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256;

type Params = { poolId: string; userId: string };

// Changes another member's role. The body is `{ role }` and nothing else (strict): the pool and the
// member come from the URL. The member's sessions in the pool end; the change is audited.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, userId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getMembersService()).changeRole(req.headers, poolId, userId, body),
  );
});

// Removes another member. Leaving the pool yourself is `POST …/leave`.
export const DELETE = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, userId } = await ctx.params;
  ctx.setActor({ poolId });
  await (await getMembersService()).remove(req.headers, poolId, userId);
  return new NextResponse(null, { status: 204 });
});
