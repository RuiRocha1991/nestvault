import { verifyEmailWithToken } from '@nestvault/services';
import { getTranslations } from 'next-intl/server';

import { LinkButton } from '@webapp/components/auth/alert';
import { AuthCard } from '@webapp/components/auth/auth-shell';
import { LinkStatus } from '@webapp/components/auth/link-status';
import { getAuth } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

/** The link of the verification email. Verifying twice is harmless, so it runs on load. */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('auth.verify');
  const verified = await verifyEmailWithToken(await getAuth(), token);

  return (
    <AuthCard>
      {verified ? (
        <LinkStatus tone="success" title={t('doneTitle')} text={t('doneText')}>
          <LinkButton href="/login">{t('continue')}</LinkButton>
        </LinkStatus>
      ) : (
        <LinkStatus tone="warning" title={t('invalidTitle')} text={t('invalidText')}>
          <LinkButton href="/login">{t('continue')}</LinkButton>
        </LinkStatus>
      )}
    </AuthCard>
  );
}
