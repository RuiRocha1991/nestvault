import { IMPORT_MAX_BYTES } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getPrototypeImportService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// The export (10 MB at most) plus the few bytes of the envelope around it.
const MAX_BODY_BYTES = IMPORT_MAX_BYTES + 1024;

// Imports the prototype's JSON export into an empty pool. `{ dryRun: true, export }` answers with
// the counts and warnings without writing; `{ dryRun: false, export }` writes everything in one
// transaction or nothing. Guards (in the service): session, strict zod body, membership (404),
// `pool.import` (owner only, 403), 20 calls an hour per pool, then `withPool` (RLS) and the audit
// entry (counts only). 409 when the pool already has data.
export const POST = route<{ poolId: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getPrototypeImportService()).run(req.headers, poolId, body),
  );
});
