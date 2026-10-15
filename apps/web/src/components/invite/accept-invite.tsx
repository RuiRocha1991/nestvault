'use client';

import { Button } from '@nestvault/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { z } from 'zod';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

type Problem = 'unavailable' | 'error' | null;

/**
 * Screen 59: the signed-in person whose email is the invite's accepts it. The server decides
 * everything (same email, verified, not expired or used); a refusal is one generic message.
 */
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('invite.accept');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [locked, startLock] = useCountdown();

  async function accept() {
    if (pending || locked > 0) return;
    setPending(true);
    setProblem(null);
    try {
      const response = await postJson(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {});
      if (response.ok) {
        const parsed = z.object({ poolId: z.uuid() }).safeParse(await response.json());
        if (parsed.success) {
          router.replace(`/${parsed.data.poolId}`);
          router.refresh();
          return;
        }
        setProblem('error');
      } else {
        const outcome = await readOutcome(response);
        if (outcome.status === 429) startLock(parseRetryAfter(outcome.retryAfter));
        else setProblem(outcome.status === 404 ? 'unavailable' : 'error');
      }
    } catch {
      setProblem('error');
    }
    setPending(false);
  }

  return (
    <>
      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {problem === 'unavailable' && (
        <ProblemAlert title={t('unavailableTitle')} text={t('unavailableText')} tone="warning" />
      )}
      {locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        />
      )}
      <Button
        variant="primary"
        disabled={pending || locked > 0}
        onClick={() => void accept()}
        className="h-[42px] w-full text-base"
      >
        <Check aria-hidden />
        {t('submit')}
      </Button>
      <Link href="/pools" className="py-1 text-center text-md font-semibold text-fg-2 no-underline">
        {t('decline')}
      </Link>
    </>
  );
}
