'use client';

import { Button } from '@nestvault/ui';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { announceSignOut } from '@webapp/lib/auth-channel';
import { invitePath } from '@webapp/lib/invite';
import { postJson } from '@webapp/lib/post-json';

/**
 * Screen 60: ends this session and goes to the sign-in screen, which brings the person back to the
 * invite afterwards. The label is a prop (shared components take their text from the page).
 */
export function SwitchAccountButton({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchAccount() {
    setPending(true);
    try {
      const response = await postJson('/api/v1/auth/sign-out', {});
      if (!response.ok) throw new Error('sign-out failed');
      announceSignOut();
      router.replace(`/login?next=${encodeURIComponent(invitePath(token))}`);
      router.refresh();
    } catch {
      setPending(false);
    }
  }

  return (
    <Button
      variant="primary"
      disabled={pending}
      onClick={() => void switchAccount()}
      className="h-[42px] w-full text-base"
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
}
