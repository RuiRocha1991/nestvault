'use client';

import { Button, cn } from '@nestvault/ui';
import { ArrowLeft, Mail } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import {
  Countdown,
  IconTile,
  LinkButton,
  LockedAlert,
  ProblemAlert,
} from '@webapp/components/auth/alert';
import { Field, IconInput } from '@webapp/components/auth/field';
import { postJson } from '@webapp/lib/post-json';
import { formatCountdown, parseRetryAfter } from '@webapp/lib/sign-in';
import { RESEND_COOLDOWN_SECONDS, useCountdown } from '@webapp/lib/use-countdown';
import '@webapp/lib/zod-csp';

const emailSchema = z.email().max(254);

type Problem = 'invalid' | 'error' | null;

/** Screens 52 (ask for the link) and 53 (the same neutral answer whether or not the account exists). */
export function ForgotForm() {
  const t = useTranslations('auth.forgot');
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [locked, startLock] = useCountdown();
  const [cooldown, startCooldown] = useCountdown();

  async function request(address: string) {
    const parsed = emailSchema.safeParse(address.trim());
    if (!parsed.success) {
      setProblem('invalid');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const response = await postJson('/api/v1/auth/request-password-reset', {
        email: parsed.data,
      });
      if (response.status === 429) {
        startLock(parseRetryAfter(response.headers.get('Retry-After')));
      } else if (response.ok) {
        setSentTo(parsed.data);
        startCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setProblem('error');
      }
    } catch {
      setProblem('error');
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending && locked === 0) void request(email);
  }

  const alerts = (
    <>
      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        />
      )}
    </>
  );

  if (sentTo) {
    return (
      <>
        <IconTile tone="success">
          <Mail />
        </IconTile>
        <div className="flex flex-col gap-2.5">
          <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('sentTitle')}</h1>
          <p className="text-md text-fg-2">
            {t.rich('sentText', { email: () => <b className="text-fg">{sentTo}</b> })}
          </p>
        </div>
        <p className="rounded-md bg-bg px-3 py-2.5 text-sm text-fg-3">{t('sentHint')}</p>
        {alerts}
        <LinkButton href="/login">{t('backToLogin')}</LinkButton>
        <p className="text-center text-sm text-fg-3">
          {t('notReceived')}{' '}
          <button
            type="button"
            disabled={pending || cooldown > 0 || locked > 0}
            onClick={() => void request(sentTo)}
            className={cn(
              'border-0 bg-transparent p-0 font-semibold text-accent-2 disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {t('resend')}
          </button>
          {cooldown > 0 && ` ${t('resendIn', { time: formatCountdown(cooldown) })}`}
        </p>
      </>
    );
  }

  const invalid = problem === 'invalid';
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('title')}</h1>
        <p className="text-md text-fg-2">{t('lead')}</p>
      </div>
      {alerts}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <Field id={emailId} label={t('email')} error={invalid && t('invalid')}>
          <IconInput
            icon={Mail}
            id={emailId}
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
        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked > 0}
          className="h-[42px] w-full text-base"
        >
          {t('submit')}
        </Button>
      </form>
      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-sm font-semibold text-accent-2 no-underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToLogin')}
      </Link>
    </>
  );
}
