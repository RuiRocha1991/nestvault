import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getCategoriesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512;

// The pool's monthly budget, own colour and hidden flag for any category it sees (global or its
// own); fields left out stay, `null` clears. Needs `categories.write`.
export const PATCH = route<{ poolId: string; id: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getCategoriesService()).updateSettings(req.headers, poolId, id, body),
  );
});
