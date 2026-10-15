'use client';

import { Button } from '@nestvault/ui';
import { Home } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { Field, IconInput } from '@webapp/components/auth/field';
import { postJson, readOutcome } from '@webapp/lib/post-json';
import { parseRetryAfter } from '@webapp/lib/sign-in';
import { useCountdown } from '@webapp/lib/use-countdown';

type Problem = 'name' | 'limit' | 'error' | null;

const NAME_MAX = 60;

/** Screens 62/63: one name field. The server decides who owns the pool: the session user. */
export function CreatePoolForm() {
  const t = useTranslations('pools.create');
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [locked, startLock] = useCountdown();

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked > 0) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      setProblem('name');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const response = await postJson('/api/v1/pools', { name: trimmed });
      if (response.ok) {
        const parsed = z.object({ id: z.uuid() }).safeParse(await response.json());
        if (!parsed.success) { setProblem('error'); return; }
        router.replace(`/${parsed.data.id}`);
        router.refresh();
        return;
      }
      const outcome = await readOutcome(response);
      if (outcome.status === 429) startLock(parseRetryAfter(outcome.retryAfter));
      else if (outcome.status === 409) setProblem('limit');
      else setProblem(outcome.status === 400 ? 'name' : 'error');
    } catch {
      setProblem('error');
    }
    setPending(false);
  }

  return (
    <>
      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {problem === 'limit' && <ProblemAlert title={t('limitTitle')} text={t('limitText')} />}
      {locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
        />
      )}
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-3.5">
        <Field id={nameId} label={t('name')} error={problem === 'name' && t('nameRequired')}>
          <IconInput
            icon={Home}
            id={nameId}
            name="name"
            autoComplete="off"
            maxLength={NAME_MAX}
            required
            placeholder={t('placeholder')}
            value={name}
            invalid={problem === 'name'}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
          <p className="text-xs text-fg-3">{t('hint')}</p>
        </Field>
        <p className="rounded-md bg-panel-2 px-3.5 py-3 text-sm text-fg-2">
          {t.rich('owner', { b: (chunks) => <b className="text-fg">{chunks}</b> })}
        </p>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || locked > 0 || name.trim().length === 0}
          className="h-[42px] w-full text-base"
        >
          {t('submit')}
        </Button>
      </form>
    </>
  );
}
