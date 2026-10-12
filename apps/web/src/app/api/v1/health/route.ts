import { HealthDto } from '@nestvault/services';
import { NextResponse } from 'next/server';

import { route } from '@webapp/server/api/route';

export const dynamic = 'force-dynamic';

// No session and no pool: liveness only. The body is built from the output schema.
export const GET = route(() =>
  Promise.resolve(NextResponse.json(HealthDto.parse({ status: 'ok' }))),
);
