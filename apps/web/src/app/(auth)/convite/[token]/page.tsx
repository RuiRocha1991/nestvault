import { getEmailStatus } from '@nestvault/services';
import { TriangleAlert } from 'lucide-react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Alert, LinkButton } from '@webapp/components/auth/alert';
import { AuthCard } from '@webapp/components/auth/auth-shell';
import { AcceptInvite } from '@webapp/components/invite/accept-invite';
import { InviteDetails, InvitePoolCard } from '@webapp/components/invite/invite-summary';
import { InviteUnavailable } from '@webapp/components/invite/invite-unavailable';
import { SwitchAccountButton } from '@webapp/components/invite/switch-account-button';
import { invitePath } from '@webapp/lib/invite';
import { getAuth, getInvitesService } from '@webapp/server/auth';
import { getCurrentSession } from '@webapp/server/session';

export const dynamic = 'force-dynamic';

// Public: the link of the invite email (screens 58-61). Four states: signed out (58), signed in with
// the invited address (59), signed in with another address (60) and a link that is not valid (61).
// Whoever holds the link may see the pool name, the inviter, the address and the role; nothing here
// accepts anything - that is `POST /api/v1/invites/{token}/accept`, which checks everything again.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestHeaders = await headers();
  const invite = await (await getInvitesService()).preview(requestHeaders, token);
  if (!invite) return <InviteUnavailable />;

  const t = await getTranslations('invite');
  const [session, status] = await Promise.all([
    getCurrentSession(),
    getAuth().then((auth) => getEmailStatus(auth, requestHeaders)),
  ]);

  const lead = invite.inviterName
    ? t.rich('lead', { inviter: invite.inviterName, pool: invite.poolName, b: (c) => <b>{c}</b> })
    : t.rich('leadNoInviter', { pool: invite.poolName, b: (c) => <b>{c}</b> });

  if (!session || !status) {
    return (
      <AuthCard>
        <Heading title={t('title')} lead={lead} />
        <InvitePoolCard {...invite} />
        <InviteDetails {...invite} />
        <LinkButton href={`/login?next=${encodeURIComponent(invitePath(token))}`}>
          {t('signIn')}
        </LinkButton>
        <p className="text-center text-xs uppercase text-fg-3">{t('or')}</p>
        <LinkButton href={`${invitePath(token)}/registar`} primary={false}>
          {t('createAccount')}
        </LinkButton>
        <p className="text-center text-sm text-fg-3">{t('createNote')}</p>
      </AuthCard>
    );
  }

  if (status.email.toLowerCase() === invite.email.toLowerCase()) {
    return (
      <AuthCard>
        <Heading
          title={t('accept.title')}
          lead={t.rich('accept.lead', { email: status.email, b: (c) => <b>{c}</b> })}
        />
        <InvitePoolCard {...invite} />
        <InviteDetails {...invite} />
        <AcceptInvite token={token} />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <Heading title={t('mismatch.title')} />
      <Alert tone="warning" icon={<TriangleAlert aria-hidden />}>
        {t.rich('mismatch.warning', {
          invited: () => <b>{invite.email}</b>,
          current: () => <b>{status.email}</b>,
        })}
      </Alert>
      <InvitePoolCard {...invite} />
      <SwitchAccountButton token={token} label={t('mismatch.switch')} />
      <p className="text-center text-sm text-fg-3">{t('mismatch.note')}</p>
    </AuthCard>
  );
}

function Heading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="text-2xl font-bold tracking-[-0.01em]">{title}</h1>
      {!!lead && <p className="text-md text-fg-2">{lead}</p>}
    </div>
  );
}
