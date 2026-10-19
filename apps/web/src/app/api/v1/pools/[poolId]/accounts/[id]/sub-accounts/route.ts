import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

// Adds a sub-account to a brokerage account. Strict body `{ name, holderId? }`; the holder must own
// the account. Needs `accounts.write`.
export const POST = route<{ poolId: string; id: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getAccountsService()).createSubAccount(req.headers, poolId, id, body),
    { status: 201 },
  );
});
