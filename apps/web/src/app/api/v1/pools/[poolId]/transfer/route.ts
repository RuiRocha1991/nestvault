import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getMembersService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// Hands the pool to another member (`pool.transfer`, owners only). The body carries the new owner
// and the caller's password; the password is checked against the stored hash and never logged.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getMembersService()).transferOwnership(req.headers, poolId, body),
  );
});
