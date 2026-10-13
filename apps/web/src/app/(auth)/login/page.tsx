import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@nestvault/services';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AuthCard, AuthFoot } from '@webapp/components/auth/auth-shell';
import { LoginForm } from '@webapp/components/auth/login-form';
import { SessionExpiredNotice } from '@webapp/components/auth/session-expired-notice';
import { SESSION_EXPIRED_REASON } from '@webapp/lib/session-reason';
import { getCurrentSession } from '@webapp/server/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }>;
}) {
  const { next, reason } = await searchParams;
  // Only same-origin relative paths are followed (open redirect); anything else is dropped.
  const destination =
    safeNextPath(typeof next === 'string' ? next : undefined) ?? DEFAULT_AFTER_SIGN_IN;

  // Already signed in: straight to the app.
  if (await getCurrentSession()) redirect(destination);

  const t = await getTranslations('auth.login');
  const { env } = await import('@nestvault/config');

  return (
    <>
      {reason === SESSION_EXPIRED_REASON ? <SessionExpiredNotice /> : null}
      <AuthCard>
        <LoginForm destination={destination} />
      </AuthCard>
      <AuthFoot>
        {t('footClosed')}
        {env.ALLOW_SIGNUP ? (
          <>
            {' '}
            <a href="/registar" className="font-semibold text-accent-2 no-underline">
              {t('createAccount')}
            </a>
          </>
        ) : null}
      </AuthFoot>
    </>
  );
}
