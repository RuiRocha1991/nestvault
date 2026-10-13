import { route } from '@webapp/server/api/route';
import { getAuth } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Better Auth owns the paths below /api/v1/auth (sign-up, sign-in, sign-out, session, password
// change, ...). The `route` wrapper adds the request id, the Origin check on writes and the access
// log; rules (closed sign-up, breached passwords) live in packages/services/src/auth.
const handle = route<{ all: string[] }>(async (req) => (await getAuth()).handler(req));

export const GET = handle;
export const POST = handle;
