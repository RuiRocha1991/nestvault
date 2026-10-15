'use client';

import { Button } from '@nestvault/ui';
import { Mail, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field, IconInput } from '@webapp/components/auth/field';
import { PasswordGuide } from '@webapp/components/auth/password-guide';
import { PasswordInput } from '@webapp/components/auth/password-input';
import { VerifyPending } from '@webapp/components/auth/verify-pending';
import { passwordProblemOf, type PasswordProblem } from '@webapp/lib/password-problem';
import { checkPassword } from '@webapp/lib/password-strength';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { INVITE_TOKEN_HEADER, signUpSchema } from '@webapp/lib/sign-up';
import { useCountdown } from '@webapp/lib/use-countdown';

const STRENGTH_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'] as const;

type Problem = PasswordProblem | 'error' | null;

/**
 * Screen 50. The server answers the same for a new address and one that already has an account, so
 * the next screen ("confirm your email") is shown either way; the rules shown here are guidance and
 * the server enforces them again.
 */
export function SignupForm({
  invite,
}: {
  invite?: { token: string; email: string; poolName: string };
}) {
  const t = useTranslations('auth.signup');
  const tInvite = useTranslations('invite.signup');
  const router = useRouter();
  const ids = { name: useId(), email: useId(), password: useId(), confirm: useId() };
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invite?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [fieldError, setFieldError] = useState<'name' | 'email' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [locked, startLock] = useCountdown();

  const check = useMemo(() => checkPassword(password, email), [password, email]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    check.longEnough &&
    check.notCommon &&
    check.notEmail &&
    confirm === password;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0) return;
    const parsed = signUpSchema.safeParse({ name: name.trim(), email: email.trim(), password });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.path[0];
      if (first === 'name' || first === 'email') {
        setFieldError(first);
        return;
      }
      setProblem('error');
      return;
    }
    if (!ready) return;
    setFieldError(null);
    setPending(true);
    setProblem(null);
    try {
      const outcome = await readOutcome(
        await postJson(
          '/api/v1/auth/sign-up/email',
          parsed.data,
          invite ? { [INVITE_TOKEN_HEADER]: invite.token } : {},
        ),
      );
      if (outcome.ok) {
        setSentTo(parsed.data.email);
        return;
      }
      if (outcome.status === 429) {
        startLock(parseRetryAfter(outcome.retryAfter));
      } else if (outcome.status === 403 && outcome.code === 'signup_closed') {
        router.refresh(); // the page now shows the closed screen
      } else {
        if (outcome.code === 'INVALID_EMAIL') setFieldError('email');
        else setProblem((outcome.status === 400 && passwordProblemOf(outcome.code)) || 'error');
      }
    } catch {
      setProblem('error');
    }
    setPending(false);
  }

  if (sentTo) {
    return invite ? (
      <VerifyPending
        email={sentTo}
        variant="signup"
        back={{ href: `/convite/${encodeURIComponent(invite.token)}`, label: tInvite('back') }}
        extraHint={tInvite('afterConfirm')}
      />
    ) : (
      <VerifyPending email={sentTo} variant="signup" />
    );
  }

  const fieldProblem = problem !== null && problem !== 'error' ? problem : null;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">
          {invite ? tInvite('title') : t('title')}
        </h1>
        <p className="text-md text-fg-2">
          {invite
            ? tInvite.rich('lead', { pool: invite.poolName, b: (chunks) => <b>{chunks}</b> })
            : t('lead')}
        </p>
      </div>

      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        />
      )}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3.5">
        <Field id={ids.name} label={t('name')} error={fieldError === 'name' && t('nameRequired')}>
          <IconInput
            icon={User}
            id={ids.name}
            name="name"
            autoComplete="name"
            maxLength={120}
            required
            placeholder={t('namePlaceholder')}
            value={name}
            invalid={fieldError === 'name'}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>

        <Field
          id={ids.email}
          label={t('email')}
          error={fieldError === 'email' && t('invalidEmail')}
        >
          <IconInput
            icon={Mail}
            id={ids.email}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            readOnly={!!invite}
            placeholder={t('emailPlaceholder')}
            value={email}
            invalid={fieldError === 'email'}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          {!!invite && <p className="text-sm text-fg-3">{tInvite('emailFixed')}</p>}
        </Field>

        <Field id={ids.password} label={t('password')}>
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
            hint={t('strength.hint')}
            rules={[
              { ok: check.longEnough, label: t('rules.length') },
              { ok: check.notCommon, label: t('rules.common') },
              { ok: check.notEmail, label: t('rules.email') },
            ]}
          />
          {fieldProblem !== null && (
            <p role="alert" className="text-sm text-neg">
              {t(fieldProblem)}
            </p>
          )}
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
        <p className="text-center text-sm text-fg-3">{t('note')}</p>
      </form>
    </>
  );
}
