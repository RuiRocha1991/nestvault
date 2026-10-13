import { hasSessionCookie } from '@nestvault/services';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SessionWatcher } from '@webapp/components/session-watcher';
import { loginUrl } from '@webapp/lib/auth-redirect';
import { NEXT_PATH_HEADER } from '@webapp/lib/next-path-header';
import { getCurrentSession } from '@webapp/server/session';

// Every page of the app needs a session. The session is read from the database here (not from a
// cookie claim), so a revoked or expired session is sent to the sign-in screen. Data access is
// still guarded again in the services; this layout is not the only check.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) {
    const requestHeaders = await headers();
    // A cookie that no longer maps to a session means it expired or was revoked: say so.
    redirect(
      loginUrl(requestHeaders.get(NEXT_PATH_HEADER), { expired: hasSessionCookie(requestHeaders) }),
    );
  }
  return (
    <>
      <SessionWatcher />
      {children}
    </>
  );
}
