import { IMPORT_MAX_BYTES } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { readUpload } from '@webapp/server/api/read-upload';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getRealEstateImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Reads a mortgage workbook or a CSV template (multipart: `file`, and optionally `loanId`,
// `propertyId`, `update`) and answers with what it holds and, once the loan and the property are
// named, what importing would do. Nothing is written. Guards (in the service): session, membership
// (404), `imports.run` (403), the Pro plan, 20 uploads an hour per pool, the body (413 over 10 MB),
// strict fields, the file's content type (415) and the parser service. The body is read only after
// the caller is known to be allowed.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const result = await (
    await getRealEstateImportsService()
  ).preview(req.headers, poolId, () => readUpload(req, { maxFileBytes: IMPORT_MAX_BYTES }));
  return NextResponse.json(result);
});
