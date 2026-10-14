import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getAccountService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Ends one of the user's own sessions (also the current one, which signs this browser out). The id
// of somebody else's session answers 404, like an unknown one.
export const DELETE = route<{ id: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { id } = await ctx.params;
  await (await getAccountService()).revokeSession(req.headers, id);
  return new NextResponse(null, { status: 204 });
});
