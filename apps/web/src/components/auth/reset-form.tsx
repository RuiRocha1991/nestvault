'use client';

import { Button } from '@nestvault/ui';
import { Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type SyntheticEvent } from 'react';

import { Alert, Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field } from '@webapp/components/auth/field';
import { PasswordGuide } from '@webapp/components/auth/password-guide';
import { PasswordInput } from '@webapp/components/auth/password-input';
import { passwordProblemOf, type PasswordProblem } from '@webapp/lib/password-problem';
import { checkPassword } from '@webapp/lib/password-strength';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

const STRENGTH_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'] as const;

type Problem = PasswordProblem | 'error' | null;

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
  const check = useMemo(() => checkPassword(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = check.longEnough && check.notCommon && confirm === password;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0) return;
    if (!ready) return;
    setPending(true);
    setProblem(null);
    try {
      const outcome = await readOutcome(
        await postJson('/api/v1/auth/reset-password', { token, newPassword: password }),
      );
      if (outcome.ok) {
        router.replace('/login?reason=password-changed');
        router.refresh();
        return;
      }
      if (outcome.status === 429) {
        startLock(parseRetryAfter(outcome.retryAfter));
      } else if (outcome.status === 400 && outcome.code === 'INVALID_TOKEN') {
        router.refresh(); // used up or expired: screen 55
      } else {
        setProblem((outcome.status === 400 && passwordProblemOf(outcome.code)) || 'error');
      }
    } catch {
      setProblem('error');
    }
    setPending(false);
  }

  const fieldProblem = problem !== null && problem !== 'error' ? problem : null;

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
        <Field id={ids.password} label={t('newPassword')}>
          <PasswordInput
            id={ids.password}
            name="new-password"
            autoComplete="new-password"
            required
            maxLength={128}
            value={password}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            invalid={fieldProblem !== null}
            onChange={(event) => {
              setPassword(event.target.value);
              setProblem(null);
            }}
          />
          <PasswordGuide
            score={check.score}
            active={password.length > 0}
            meterLabel={t('strength.label')}
            levels={STRENGTH_KEYS.map((key) => t(`strength.${key}`))}
            rules={[
              { ok: check.longEnough, label: t('rules.length') },
              { ok: check.notCommon, label: t('rules.common') },
            ]}
          />
          {fieldProblem !== null && <p className="text-sm text-neg">{t(fieldProblem)}</p>}
        </Field>

        <Field id={ids.confirm} label={t('confirmPassword')}>
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
        </Field>

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
