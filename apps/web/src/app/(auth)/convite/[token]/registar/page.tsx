import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthCard } from '@webapp/components/auth/auth-shell';
import { SignupForm } from '@webapp/components/auth/signup-form';
import { InviteUnavailable } from '@webapp/components/invite/invite-unavailable';
import { invitePath } from '@webapp/lib/invite';
import { getInvitesService } from '@webapp/server/auth';
import { getCurrentSession } from '@webapp/server/session';

export const dynamic = 'force-dynamic';

// Public: "Criar conta com este email" of screen 58. Registration is open through a valid invite
// even with ALLOW_SIGNUP=false; the email is fixed to the invite's and the token travels in the
// `x-invite-token` header, which the sign-up hook checks again on the server.
export default async function InviteSignupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Somebody who is already signed in has an account: the invite page is where they accept.
  if (await getCurrentSession()) redirect(invitePath(token));

  const invite = await (await getInvitesService()).preview(await headers(), token);
  if (!invite) return <InviteUnavailable />;

  return (
    <AuthCard>
      <SignupForm invite={{ token, email: invite.email, poolName: invite.poolName }} />
    </AuthCard>
  );
}
