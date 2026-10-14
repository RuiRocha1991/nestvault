'use client';

import { Button, cn } from '@nestvault/ui';
import { Check, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Alert, Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { PasswordInput } from '@webapp/components/auth/password-input';
import { checkPassword } from '@webapp/lib/password-strength';
import { postJson } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

const STRENGTH_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'] as const;

type Problem = 'breached' | 'error' | null;

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={cn('flex items-center gap-1.5 text-sm', ok ? 'text-pos' : 'text-fg-3')}>
      <Check aria-hidden className={cn('size-3.5', !ok && 'opacity-40')} />
      {children}
    </li>
  );
}

/** Screen 54. The token only travels in the request body; a used or expired one reloads into screen 55. */
export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('auth.reset');
  const router = useRouter();
  const ids = { password: useId(), confirm: useId() };
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [locked, startLock] = useCountdown();
  const check = checkPassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = check.longEnough && check.notCommon && confirm === password;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0) return;
    if (!ready) return;
    setPending(true);
    setProblem(null);
    try {
      const response = await postJson('/api/v1/auth/reset-password', {
        token,
        newPassword: password,
      });
      if (response.ok) {
        router.replace('/login?reason=password-changed');
        router.refresh();
        return;
      }
      if (response.status === 429) {
        startLock(parseRetryAfter(response.headers.get('Retry-After')));
      } else if (response.status === 400) {
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
        if (body?.code === 'PASSWORD_BREACHED') setProblem('breached');
        else if (body?.code === 'INVALID_TOKEN')
          router.refresh(); // used up or expired: screen 55
        else setProblem('error');
      } else {
        setProblem('error');
      }
    } catch {
      setProblem('error');
    }
    setPending(false);
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('title')}</h1>
        <p className="text-md text-fg-2">{t('lead')}</p>
      </div>

      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        />
      )}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.password} className="text-sm font-medium text-fg-2">
            {t('newPassword')}
          </label>
          <PasswordInput
            id={ids.password}
            name="new-password"
            autoComplete="new-password"
            required
            maxLength={128}
            value={password}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            invalid={problem === 'breached'}
            onChange={(event) => {
              setPassword(event.target.value);
              setProblem(null);
            }}
          />
          <div
            role="meter"
            aria-label={t('strength.label')}
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={check.score}
            aria-valuetext={t(`strength.${STRENGTH_KEYS[check.score]}`)}
            className="mt-1 grid grid-cols-4 gap-1.5"
          >
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={cn(
                  'h-1 rounded-full',
                  step <= check.score ? (check.score >= 3 ? 'bg-pos' : 'bg-warn') : 'bg-line-2',
                )}
              />
            ))}
          </div>
          {password && (
            <p className={cn('text-sm', check.score >= 3 ? 'text-pos' : 'text-fg-3')}>
              {t(`strength.${STRENGTH_KEYS[check.score]}`)}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            <Rule ok={check.longEnough}>{t('rules.length')}</Rule>
            <Rule ok={check.notCommon}>{t('rules.common')}</Rule>
          </ul>
          {problem === 'breached' && <p className="text-sm text-neg">{t('breached')}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.confirm} className="text-sm font-medium text-fg-2">
            {t('confirmPassword')}
          </label>
          <PasswordInput
            id={ids.confirm}
            name="confirm-password"
            autoComplete="new-password"
            required
            maxLength={128}
            value={confirm}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            invalid={mismatch}
            onChange={(event) => {
              setConfirm(event.target.value);
            }}
          />
          {mismatch && <p className="text-sm text-neg">{t('mismatch')}</p>}
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked > 0 || !ready}
          className="h-[42px] w-full text-base"
        >
          {t('submit')}
        </Button>
      </form>

      <Alert tone="info" icon={<Info aria-hidden />}>
        <span className="text-fg-2">{t('note')}</span>
      </Alert>
    </>
  );
}
