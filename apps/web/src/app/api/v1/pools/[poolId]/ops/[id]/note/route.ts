import { NextResponse } from 'next/server';

import { readJson } from '@webapp/server/api/read-json';
import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getNotesService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// 2 000 characters, up to 6 bytes each once JSON-escaped.
const MAX_BODY_BYTES = 16 * 1024;

type Params = { poolId: string; id: string };

// Sets or clears the note of an investment operation (`notes.write`). Same guards as the
// movement note.
export const PATCH = route<Params>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, id } = await ctx.params;
  ctx.setActor({ poolId });
  const body = await readJson(req, { maxBytes: MAX_BODY_BYTES });
  return NextResponse.json(
    await (await getNotesService()).setOperationNote(req.headers, poolId, id, body),
  );
});
