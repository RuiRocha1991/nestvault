import { getEmailStatus } from '@nestvault/services';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthCard } from '@webapp/components/auth/auth-shell';
import { VerifyPending } from '@webapp/components/auth/verify-pending';
import { loginUrl } from '@webapp/lib/auth-redirect';
import { getAuth } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

/** "Confirma o teu email" for a signed-in user whose address is not verified yet. */
export default async function VerifyEmailPendingPage() {
  const status = await getEmailStatus(await getAuth(), await headers());
  if (!status) redirect(loginUrl('/verificar'));
  if (status.emailVerified) redirect('/pools');
  return (
    <AuthCard>
      <VerifyPending email={status.email} />
    </AuthCard>
  );
}
