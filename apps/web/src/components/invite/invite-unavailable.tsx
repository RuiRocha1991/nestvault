import { useTranslations } from 'next-intl';

import { LinkButton } from '@webapp/components/auth/alert';
import { AuthCard } from '@webapp/components/auth/auth-shell';
import { LinkStatus } from '@webapp/components/auth/link-status';

/**
 * Screen 61. One message for an unknown, expired, used or malformed link, so the page never tells
 * which one it was (and never names the pool or the inviter).
 */
export function InviteUnavailable() {
  const t = useTranslations('invite.unavailable');
  return (
    <AuthCard>
      <LinkStatus tone="warning" title={t('title')} text={t('text')}>
        <LinkButton href="/login">{t('back')}</LinkButton>
      </LinkStatus>
    </AuthCard>
  );
}
