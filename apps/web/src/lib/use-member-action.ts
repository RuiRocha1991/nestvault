'use client';

import { useState } from 'react';

import { readProblem, type ApiProblem } from '@webapp/lib/members-api';
import { useCountdown } from '@webapp/lib/use-countdown';

const NETWORK_PROBLEM: ApiProblem = { status: 0, code: null, issuePaths: [], retryAfterSeconds: 0 };

/**
 * Runs one request of a members dialog: one at a time, the failure kept for the dialog to show and
 * a pause counted down when the server answered 429. `onDone` runs after a successful answer.
 */
export function useMemberAction(onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [locked, startLock] = useCountdown();

  async function run(request: () => Promise<Response>) {
    if (pending || locked > 0) return;
    setPending(true);
    setProblem(null);
    try {
      const response = await request();
      if (response.ok) {
        onDone();
      } else {
        const failed = await readProblem(response);
        if (failed.status === 429) startLock(failed.retryAfterSeconds);
        setProblem(failed);
      }
    } catch {
      setProblem(NETWORK_PROBLEM);
    }
    setPending(false);
  }

  const clearProblem = () => {
    setProblem(null);
  };

  /** True while a request runs or a 429 pause is counting down: the submit button is off. */
  const busy = pending || locked > 0;

  return { pending, busy, problem, locked, run, clearProblem };
}
