import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

// Writes a pending import into the chosen account, all or nothing. Lines the account already has are
// left alone (the same file twice adds nothing); notes and categories chosen by hand are never
// touched. A batch of another pool answers 404; one already settled, 409.
export const POST = route<{ poolId: string; batchId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, batchId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getImportsService()).commit(req.headers, poolId, batchId, body),
  );
});
