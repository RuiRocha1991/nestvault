import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getInvitesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Accepts an invite as the signed-in user. There is no pool membership to check yet (this is how it
// is created): the guards are the session, the token in the path and the service, which answers the
// same 404 for an unknown, expired or used token, another account's invite and an unverified address.
export const POST = route<{ token: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { token } = await ctx.params;
  return NextResponse.json(await (await getInvitesService()).accept(req.headers, token));
});
