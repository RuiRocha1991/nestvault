import type { ReactNode } from 'react';

import { AuthShell } from '@webapp/components/auth/auth-shell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
