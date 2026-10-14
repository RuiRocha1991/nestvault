'use client';

import { Button, Card, CardHeader } from '@nestvault/ui';
import { Clock, Info, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Alert, Countdown } from '@webapp/components/auth/alert';
import { PasswordInput } from '@webapp/components/auth/password-input';
import { checkPassword } from '@webapp/lib/password-strength';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

type Status = 'idle' | 'saved' | 'wrongCurrent' | 'breached' | 'tooCommon' | 'error';

const STATUS_BY_CODE: Record<string, Status> = {
  PASSWORD_BREACHED: 'breached',
  PASSWORD_TOO_COMMON: 'tooCommon',
  INVALID_PASSWORD: 'wrongCurrent',
};

/** The other sessions end with the change, so the form says so before it is used. */
export function PasswordForm() {
  const t = useTranslations('account.password');
  const router = useRouter();
  const ids = { current: useId(), next: useId(), confirm: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [locked, startLock] = useCountdown();

  const check = checkPassword(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && check.longEnough && check.notCommon && confirm === next;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0 || !ready) return;
    setPending(true);
    setStatus('idle');
    try {
      const outcome = await readOutcome(
        await postJson('/api/v1/auth/change-password', {
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        }),
      );
      if (outcome.ok) {
        setCurrent('');
        setNext('');
        setConfirm('');
        setStatus('saved');
        router.refresh(); // the sessions list lost every other device
      } else if (outcome.status === 429) {
        startLock(parseRetryAfter(outcome.retryAfter));
      } else {
        setStatus((outcome.status === 400 && STATUS_BY_CODE[String(outcome.code)]) || 'error');
      }
    } catch {
      setStatus('error');
    }
    setPending(false);
  }

  return (
    <Card>
      <CardHeader title={t('title')} />
      {locked > 0 && (
        <Alert tone="warning" icon={<Clock aria-hidden />}>
          {t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        </Alert>
      )}
      {status === 'error' && (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          {t('errorText')}
        </Alert>
      )}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.current} className="text-sm font-medium text-fg-2">
            {t('current')}
          </label>
          <PasswordInput
            id={ids.current}
            name="current-password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={current}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            invalid={status === 'wrongCurrent'}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
          {status === 'wrongCurrent' && (
            <p role="alert" className="text-sm text-neg">
              {t('wrongCurrent')}
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.next} className="text-sm font-medium text-fg-2">
              {t('new')}
            </label>
            <PasswordInput
              id={ids.next}
              name="new-password"
              autoComplete="new-password"
              required
              maxLength={128}
              placeholder={t('placeholder')}
              value={next}
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              invalid={status === 'breached' || status === 'tooCommon'}
              onChange={(event) => {
                setNext(event.target.value);
              }}
            />
            {(status === 'breached' || status === 'tooCommon') && (
              <p role="alert" className="text-sm text-neg">
                {t(status)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.confirm} className="text-sm font-medium text-fg-2">
              {t('confirm')}
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
        </div>

        <Alert tone="info" icon={<Info aria-hidden />}>
          {t('note')}
        </Alert>
        {status === 'saved' && (
          <p role="status" className="text-sm text-pos">
            {t('saved')}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked > 0 || !ready}
          className="self-end"
        >
          {t('submit')}
        </Button>
      </form>
    </Card>
  );
}
