'use client';

import { Button } from '@nestvault/ui';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Alert } from '@webapp/components/auth/alert';
import { LinkStatus } from '@webapp/components/auth/link-status';
import { postJson } from '@webapp/lib/post-json';
import { formatCountdown, parseRetryAfter } from '@webapp/lib/sign-in';
import { RESEND_COOLDOWN_SECONDS, useCountdown } from '@webapp/lib/use-countdown';

/** Screen 56. `email` is the signed-in user's own address, read on the server from the session. */
export function VerifyPending({
  email,
  variant = 'account',
}: {
  email: string;
  /** `signup`: shown right after registering, with no session yet, so "change" goes back to the form. */
  variant?: 'account' | 'signup';
}) {
  const t = useTranslations('auth.verify');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [cooldown, startCooldown] = useCountdown();
  const change =
    variant === 'signup'
      ? ({ href: '/registar', label: 'changeSignup' } as const)
      : ({ href: '/conta', label: 'change' } as const);

  async function resend() {
    if (pending || cooldown > 0) return;
    setPending(true);
    try {
      const response = await postJson('/api/v1/auth/send-verification-email', { email });
      if (response.status === 429) {
        startCooldown(parseRetryAfter(response.headers.get('Retry-After')));
        setState('idle');
      } else if (response.ok) {
        setState('sent');
        startCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
    setPending(false);
  }

  return (
    <LinkStatus
      tone="accent"
      title={t('pendingTitle')}
      text={t.rich('pendingText', { email: () => <b className="text-fg">{email}</b> })}
    >
      {state === 'error' && (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          {t('errorText')}
        </Alert>
      )}
      <Button
        disabled={pending || cooldown > 0}
        onClick={() => void resend()}
        className="h-[42px] w-full text-base"
      >
        <RefreshCw aria-hidden />
        {t('resend')}
        {cooldown > 0 && (
          <span className="tabular-nums text-fg-3">
            {t('cooldown', { time: formatCountdown(cooldown) })}
          </span>
        )}
      </Button>
      {state === 'sent' && (
        <p role="status" className="text-center text-sm text-pos">
          {t('resent')}
        </p>
      )}
      <Link
        href={change.href}
        className="py-2 text-center text-md font-semibold text-fg-2 no-underline"
      >
        {t(change.label)}
      </Link>
      <p className="rounded-md bg-bg px-3 py-2.5 text-sm text-fg-3">{t('pendingHint')}</p>
    </LinkStatus>
  );
}
