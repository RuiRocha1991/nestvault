import { isResetTokenValid } from '@nestvault/services';
import { getTranslations } from 'next-intl/server';

import { LinkButton } from '@webapp/components/auth/alert';
import { AuthCard } from '@webapp/components/auth/auth-shell';
import { LinkStatus } from '@webapp/components/auth/link-status';
import { ResetForm } from '@webapp/components/auth/reset-form';
import { getAuth } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

/** The token of the emailed link. Checked here without using it up; the form submits it once. */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations('auth.reset');
  const valid = await isResetTokenValid(await getAuth(), token);

  return (
    <AuthCard>
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <LinkStatus tone="warning" title={t('invalidTitle')} text={t('invalidText')}>
          <LinkButton href="/recuperar">{t('requestNew')}</LinkButton>
          <a href="/login" className="text-center text-sm font-semibold text-accent-2 no-underline">
            {t('backToLogin')}
          </a>
        </LinkStatus>
      )}
    </AuthCard>
  );
}
