import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// 10 000 characters, up to 6 bytes each once JSON-escaped.
const MAX_BODY_BYTES = 64 * 1024;

type Params = { poolId: string; month: string };

// The note of a month (`yyyy-mm`). Guards (in the service): session, zod, membership (404), `pool.read`.
export const GET = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, month } = await ctx.params;
  ctx.setActor({ poolId });
  return NextResponse.json(
    await (await getNotesService()).getMonthNote(req.headers, poolId, month),
  );
});

// Writes the note of a month with optimistic locking (`notes.write`); 409 carries the current version.
export const PUT = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, month } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getNotesService()).putMonthNote(req.headers, poolId, month, body),
  );
});
