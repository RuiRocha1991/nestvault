'use client';

import { Button } from '@nestvault/ui';
import { Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field, IconInput } from '@webapp/components/auth/field';
import { PasswordInput } from '@webapp/components/auth/password-input';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { formatCountdown, interpretSignInResponse, signInSchema } from '@webapp/lib/sign-in';

type Problem = 'invalid' | 'unverified' | 'error' | null;

export interface LoginFormProps {
  /** Already validated with `safeNextPath` on the server; falls back to the pool chooser. */
  destination: string;
}

export function LoginForm({ destination }: LoginFormProps) {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const ids = { email: useId(), password: useId() };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  // Seconds left of a rate-limit pause; the server decides it, the page only counts down.
  const [secondsLeft, setSecondsLeft] = useState(0);
  const locked = secondsLeft > 0;

  useEffect(() => {
    if (!locked) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [locked]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked) return;
    const parsed = signInSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setProblem('invalid');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const response = await postJson('/api/v1/auth/sign-in/email', parsed.data);
      const result = interpretSignInResponse(await readOutcome(response));
      if (result.status === 'ok') {
        router.replace(destination);
        router.refresh();
        return;
      }
      if (result.status === 'rate_limited') setSecondsLeft(result.retryAfterSeconds);
      else setProblem(result.status);
      setPending(false);
    } catch {
      setProblem('error');
      setPending(false);
    }
  }

  const invalid = problem === 'invalid';

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('title')}</h1>
        <p className="text-md text-fg-2">{t('lead')}</p>
      </div>

      {problem === 'unverified' && (
        <ProblemAlert tone="warning" title={t('unverifiedTitle')} text={t('unverifiedText')} />
      )}
      {(problem === 'invalid' || problem === 'error') && (
        <ProblemAlert title={t(`${problem}Title`)} text={t(`${problem}Text`)} />
      )}
      {locked && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={secondsLeft} /> })}
        />
      )}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3.5">
        <Field id={ids.email} label={t('email')}>
          <IconInput
            icon={Mail}
            id={ids.email}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            placeholder={t('emailPlaceholder')}
            invalid={invalid}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>

        <Field
          id={ids.password}
          label={t('password')}
          aside={
            <Link href="/recuperar" className="text-sm font-semibold text-accent-2 no-underline">
              {t('forgot')}
            </Link>
          }
        >
          <PasswordInput
            id={ids.password}
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            invalid={invalid}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked}
          className="h-[42px] w-full text-base"
        >
          {locked ? t('retryIn', { time: formatCountdown(secondsLeft) }) : t('submit')}
        </Button>
      </form>

      <p className="text-center text-sm text-fg-3">{t('sessionNote')}</p>
    </>
  );
}
