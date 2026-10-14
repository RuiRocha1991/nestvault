import { AuthCard } from '@webapp/components/auth/auth-shell';
import { ForgotForm } from '@webapp/components/auth/forgot-form';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <AuthCard>
      <ForgotForm />
    </AuthCard>
  );
}
