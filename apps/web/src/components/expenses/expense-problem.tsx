'use client';

import { useTranslations } from 'next-intl';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import type { ApiProblem } from '@webapp/lib/members-api';

/** The banner of a Despesas dialog after a failed request (a 429 shows the pause instead). */
export function ExpenseProblem({
  problem,
  locked,
  hiddenStatuses = [],
}: {
  problem: ApiProblem | null;
  locked: number;
  /** Statuses a dialog explains next to a field instead (a 409 name clash). */
  hiddenStatuses?: readonly number[];
}) {
  const t = useTranslations('expenses');
  if (locked > 0) {
    return (
      <LockedAlert
        title={t('lockedTitle')}
        text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
      />
    );
  }
  if (!problem || hiddenStatuses.includes(problem.status)) return null;
  return (
    <ProblemAlert
      title={t('problemTitle')}
      text={problem.status === 403 ? t('forbiddenText') : t('problemText')}
    />
  );
}
