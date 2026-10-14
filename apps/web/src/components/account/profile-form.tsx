'use client';

import { Button, Card, CardHeader, Chip, Input } from '@nestvault/ui';
import { Clock, Mail, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import { Alert, Countdown } from '@webapp/components/auth/alert';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'emailSent'; email: string }
  | { kind: 'error' }
  | { kind: 'invalidEmail' };

const emailSchema = z.email();

export interface ProfileFormProps {
  name: string;
  email: string;
  emailVerified: boolean;
  /** Initial of the name for the avatar. */
  initial: string;
}

/** Name and email of the signed-in user. A new email only takes effect once the new address confirms it. */
export function ProfileForm({
  name: savedName,
  email: savedEmail,
  emailVerified,
  initial,
}: ProfileFormProps) {
  const t = useTranslations('account.profile');
  const router = useRouter();
  const ids = { name: useId(), email: useId() };
  const [name, setName] = useState(savedName);
  const [email, setEmail] = useState(savedEmail);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [locked, startLock] = useCountdown();

  const nameChanged = name.trim() !== savedName;
  const emailChanged = email.trim().toLowerCase() !== savedEmail.toLowerCase();

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0 || (!nameChanged && !emailChanged)) return;
    if (emailChanged && !emailSchema.safeParse(email.trim()).success) {
      setStatus({ kind: 'invalidEmail' });
      return;
    }
    setPending(true);
    setStatus({ kind: 'idle' });
    try {
      let failed: Response | null = null;
      if (nameChanged) {
        const response = await sendJson('PATCH', '/api/v1/me', { name: name.trim() });
        if (!response.ok) failed = response;
      }
      const sent = email.trim();
      if (!failed && emailChanged) {
        const response = await postJson('/api/v1/auth/change-email', { newEmail: sent });
        if (!response.ok) failed = response;
      }
      if (failed?.status === 429) {
        startLock(parseRetryAfter(failed.headers.get('Retry-After')));
      } else if (failed) {
        setStatus({ kind: 'error' });
      } else {
        if (emailChanged) setEmail(savedEmail); // the address only changes after the link is used
        setStatus(emailChanged ? { kind: 'emailSent', email: sent } : { kind: 'saved' });
        router.refresh();
      }
    } catch {
      setStatus({ kind: 'error' });
    }
    setPending(false);
  }

  return (
    <Card>
      <CardHeader title={t('title')} />
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-full bg-grad-warm text-lg font-bold text-white"
        >
          {initial}
        </span>
        <p className="text-md font-semibold">{savedName}</p>
      </div>

      {locked > 0 && (
        <Alert tone="warning" icon={<Clock aria-hidden />}>
          {t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        </Alert>
      )}
      {status.kind === 'error' && (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          {t('errorText')}
        </Alert>
      )}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-sm font-medium text-fg-2">
              {t('name')}
            </label>
            <Input
              id={ids.name}
              name="name"
              autoComplete="name"
              maxLength={120}
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.email} className="text-sm font-medium text-fg-2">
              {t('email')}
            </label>
            <div className="relative flex">
              <Input
                id={ids.email}
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                aria-invalid={status.kind === 'invalidEmail'}
                aria-describedby={`${ids.email}-hint`}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                className="h-10 pr-24"
              />
              {emailVerified ? (
                <Chip tone="pos" className="absolute right-2 top-[9px]">
                  {t('verified')}
                </Chip>
              ) : (
                <Link href="/verificar" className="absolute right-2 top-[9px] no-underline">
                  <Chip tone="warn">
                    <Mail aria-hidden className="size-3" />
                    {t('unverified')}
                  </Chip>
                </Link>
              )}
            </div>
            <p id={`${ids.email}-hint`} className="text-xs text-fg-3">
              {t('emailHint')}
            </p>
            {status.kind === 'invalidEmail' && (
              <p role="alert" className="text-sm text-neg">
                {t('emailInvalid')}
              </p>
            )}
          </div>
        </div>

        {status.kind === 'saved' && (
          <p role="status" className="text-sm text-pos">
            {t('saved')}
          </p>
        )}
        {status.kind === 'emailSent' && (
          <p role="status" className="text-sm text-pos">
            {t.rich('emailSent', { email: () => <b className="text-fg">{status.email}</b> })}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked > 0 || (!nameChanged && !emailChanged)}
          className="self-end"
        >
          {t('save')}
        </Button>
      </form>
    </Card>
  );
}
