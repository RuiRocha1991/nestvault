import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { loginUrl } from '@webapp/lib/auth-redirect';
import { NEXT_PATH_HEADER } from '@webapp/lib/next-path-header';
import { getCurrentSession } from '@webapp/server/session';

// Every page of the app needs a session. The session is read from the database here (not from a
// cookie claim), so a revoked or expired session is sent to the sign-in screen. Data access is
// still guarded again in the services; this layout is not the only check.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect(loginUrl((await headers()).get(NEXT_PATH_HEADER)));
  return children;
}
