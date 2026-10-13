'use client';

import { Button, cn, Input } from '@nestvault/ui';
import { Clock, Eye, EyeOff, KeyRound, Mail, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent, type ReactNode } from 'react';

import { postJson } from '@webapp/lib/post-json';
import { formatCountdown, interpretSignInResponse, signInSchema } from '@webapp/lib/sign-in';

const alertStyles = {
  error: 'border-neg bg-[color-mix(in_srgb,var(--neg)_12%,transparent)] [&_svg]:text-neg',
  warning: 'border-warn bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] [&_svg]:text-warn',
};

function Alert({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof alertStyles;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-md [&_svg]:mt-px [&_svg]:size-[18px] [&_svg]:shrink-0',
        alertStyles[tone],
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}

type Problem = 'invalid' | 'error' | null;

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
  const [showPassword, setShowPassword] = useState(false);
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
      const result = interpretSignInResponse(response.status, response.headers.get('Retry-After'));
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
  const fieldStyles = cn(
    'h-10 pl-[38px]',
    invalid && 'border-neg shadow-[inset_0_0_0_1px_var(--neg)]',
  );
  const iconStyles = 'pointer-events-none absolute left-3 top-[11px] size-[18px] text-fg-3';

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('title')}</h1>
        <p className="text-md text-fg-2">{t('lead')}</p>
      </div>

      {problem ? (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          <b>{t(`${problem}Title`)}</b>
          <br />
          <span className="text-fg-2">{t(`${problem}Text`)}</span>
        </Alert>
      ) : null}
      {locked ? (
        <Alert tone="warning" icon={<Clock aria-hidden />}>
          <b>{t('lockedTitle')}</b>
          <br />
          <span className="text-fg-2">
            {t.rich('lockedText', {
              time: () => <b className="tabular-nums">{formatCountdown(secondsLeft)}</b>,
            })}
          </span>
        </Alert>
      ) : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.email} className="text-sm font-medium text-fg-2">
            {t('email')}
          </label>
          <div className="relative flex">
            <Mail aria-hidden className={iconStyles} />
            <Input
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
              aria-invalid={invalid}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className={fieldStyles}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={ids.password} className="text-sm font-medium text-fg-2">
              {t('password')}
            </label>
            <Link href="/recuperar" className="text-sm font-semibold text-accent-2 no-underline">
              {t('forgot')}
            </Link>
          </div>
          <div className="relative flex">
            <KeyRound aria-hidden className={iconStyles} />
            <Input
              id={ids.password}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              aria-invalid={invalid}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              className={cn(fieldStyles, 'pr-10')}
            />
            <button
              type="button"
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              aria-pressed={showPassword}
              onClick={() => {
                setShowPassword((current) => !current);
              }}
              className="absolute right-1.5 top-[5px] grid size-[30px] place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-3 hover:text-fg"
            >
              {showPassword ? (
                <EyeOff aria-hidden className="size-4" />
              ) : (
                <Eye aria-hidden className="size-4" />
              )}
            </button>
          </div>
        </div>

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
