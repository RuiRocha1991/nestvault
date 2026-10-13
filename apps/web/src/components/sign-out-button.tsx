'use client';

import { Button } from '@nestvault/ui';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { announceSignOut } from '@webapp/lib/auth-channel';
import { postJson } from '@webapp/lib/post-json';

/**
 * Revokes the session on the server (Better Auth deletes the row and clears the cookie), then goes
 * to the sign-in screen. A failed request keeps the user where they are with the button usable again.
 */
export function SignOutButton() {
  const t = useTranslations('shell');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const response = await postJson('/api/v1/auth/sign-out', {});
      if (!response.ok) throw new Error('sign-out failed');
      // Other tabs of this browser would otherwise keep showing the app until their next reload.
      announceSignOut();
      router.replace('/login');
      router.refresh();
    } catch {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => void signOut()}
      className="justify-start"
    >
      <LogOut aria-hidden />
      {t('signOut')}
    </Button>
  );
}
