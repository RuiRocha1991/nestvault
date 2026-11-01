import { IMPORT_MAX_BYTES } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { readUpload } from '@webapp/server/api/read-upload';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getRealEstateImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Writes what the preview showed into the loan and the property, all or nothing. The same file
// twice adds nothing; notes, descriptions and links to bank movements are never touched. Guards (in
// the service): session, membership (404), `imports.run` and `realestate.write` (403), the Pro plan,
// the upload rate limit, strict fields, the loan and property being the pool's own (400), `withPool`
// (RLS) and the audit entry. Write routes require `Origin` to match the app (CSRF).
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const result = await (
    await getRealEstateImportsService()
  ).commit(req.headers, poolId, () => readUpload(req, { maxFileBytes: IMPORT_MAX_BYTES }));
  return NextResponse.json(result);
});
