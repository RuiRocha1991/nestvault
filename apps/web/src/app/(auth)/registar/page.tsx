import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LinkButton } from '@webapp/components/auth/alert';
import { AuthCard, AuthFoot } from '@webapp/components/auth/auth-shell';
import { LinkStatus } from '@webapp/components/auth/link-status';
import { SignupForm } from '@webapp/components/auth/signup-form';
import { getCurrentSession } from '@webapp/server/session';

export const dynamic = 'force-dynamic';

// Public. Open only with ALLOW_SIGNUP=true (screen 50); otherwise the closed screen explains that
// people join by invite (screen 51). The API refuses sign-ups too (403 signup_closed): this page
// is only the explanation.
export default async function SignupPage() {
  if (await getCurrentSession()) redirect('/pools');

  const t = await getTranslations('auth.signup');
  const { env } = await import('@nestvault/config');

  if (!env.ALLOW_SIGNUP) {
    return (
      <>
        <AuthCard>
          <LinkStatus tone="locked" title={t('closedTitle')} text={t('closedLead')}>
            <p className="rounded-md bg-bg px-3 py-2.5 text-sm text-fg-3">{t('closedNote')}</p>
            <LinkButton href="/login">{t('closedBack')}</LinkButton>
          </LinkStatus>
        </AuthCard>
        <AuthFoot>{t('closedFoot')}</AuthFoot>
      </>
    );
  }

  return (
    <>
      <AuthCard>
        <SignupForm />
      </AuthCard>
      <AuthFoot>
        {t('haveAccount')}{' '}
        <a href="/login" className="font-semibold text-accent-2 no-underline">
          {t('signIn')}
        </a>
      </AuthFoot>
    </>
  );
}
