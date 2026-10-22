import { IMPORT_MAX_BYTES } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { readUpload } from '@webapp/server/api/read-upload';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Uploads a statement (multipart: `file`, and optionally `accountId`, `parserId`, `spec`) and
// answers with its preview, a choice of formats or a column mapping to confirm. Nothing is written
// to the ledger. Guards (in the service): session, membership (404), `imports.run` (403), 20
// uploads an hour per pool, the body (413 over 10 MB), strict fields, then the file's content type
// (415), the parser service, `withPool` (RLS) and the audit entry. The body is read only after
// the caller is known to be allowed.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const result = await (
    await getImportsService()
  ).start(req.headers, poolId, () => readUpload(req, { maxFileBytes: IMPORT_MAX_BYTES }));
  return NextResponse.json(result, { status: result.status === 'preview' ? 201 : 200 });
});
