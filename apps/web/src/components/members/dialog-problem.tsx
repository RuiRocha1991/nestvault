'use client';

import { useTranslations } from 'next-intl';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { problemKey, type ApiProblem } from '@webapp/lib/members-api';

const TEXT_KEY = {
  forbidden: 'forbiddenText',
  missing: 'missingText',
  lastOwner: 'lastOwnerText',
  error: 'errorText',
} as const;

/**
 * The banner of a members dialog after a failed request. A problem on a named field (the password)
 * is shown next to that field instead, so `hiddenPaths` keeps it out of the banner.
 */
export function DialogProblem({
  problem,
  locked,
  hiddenPaths = [],
}: {
  problem: ApiProblem | null;
  locked: number;
  hiddenPaths?: readonly string[];
}) {
  const t = useTranslations('members.dialog');
  if (locked > 0) {
    return (
      <LockedAlert
        title={t('lockedTitle')}
        text={t.rich('lockedText', { time: () => <Countdown seconds={locked} /> })}
      />
    );
  }
  if (!problem || problem.issuePaths.some((path) => hiddenPaths.includes(path))) return null;
  return <ProblemAlert title={t('errorTitle')} text={t(TEXT_KEY[problemKey(problem)])} />;
}
