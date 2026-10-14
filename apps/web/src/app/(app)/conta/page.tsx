import { Button, Card, CardHeader, Chip } from '@nestvault/ui';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { PasswordForm } from '@webapp/components/account/password-form';
import { ProfileForm } from '@webapp/components/account/profile-form';
import { SessionsCard } from '@webapp/components/account/sessions-card';
import { Topbar } from '@webapp/components/topbar';
import { formatRelative } from '@webapp/lib/relative-time';
import { getAccountService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// Screen 65. Outside every pool. The (app) layout sent anonymous visitors to the sign-in screen; the
// service checks the session again and only ever returns the caller's own data.
export default async function AccountPage() {
  const t = await getTranslations('account');
  const requestHeaders = await headers();
  const account = await getAccountService();
  const [me, { sessions }] = await Promise.all([
    account.getMe(requestHeaders),
    account.listSessions(requestHeaders),
  ]);
  const now = new Date();

  return (
    <>
      <Topbar title={t('title')} />
      <p className="-mt-3 mb-5 text-sm text-fg-3">{t('lead')}</p>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <ProfileForm
            name={me.name}
            email={me.email}
            emailVerified={me.emailVerified}
            initial={me.name.trim().charAt(0).toUpperCase()}
          />
          <PasswordForm />
        </div>

        <SessionsCard
          sessions={sessions.map((session) => ({
            id: session.id,
            current: session.current,
            browser: session.browser,
            os: session.os,
            kind: session.kind,
            ipMasked: session.ipMasked,
            lastActive: formatRelative(new Date(session.lastActiveAt), now),
          }))}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card aria-disabled>
            <CardHeader title={t('twoFactor.title')} actions={<Chip>{t('twoFactor.soon')}</Chip>} />
            <p className="text-sm text-fg-3">{t('twoFactor.text')}</p>
            <Button disabled className="self-start">
              <ShieldCheck aria-hidden />
              {t('twoFactor.activate')}
            </Button>
          </Card>
          <Card>
            <CardHeader title={t('data.title')} subtitle={t('data.text')} />
            <Button disabled className="self-start">
              <Download aria-hidden />
              {t('data.export')}
            </Button>
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <h3 className="text-md font-semibold text-neg">{t('data.deleteTitle')}</h3>
              <p className="text-sm text-fg-3">{t('data.deleteText')}</p>
              <Button variant="danger" disabled className="self-start border-neg">
                <Trash2 aria-hidden />
                {t('data.delete')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
