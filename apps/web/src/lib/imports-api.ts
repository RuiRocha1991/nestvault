import { readProblem, type ApiProblem } from '@webapp/lib/members-api';

import type { ImportCommitResult, ImportPreview, ImportStart } from './imports-types';

// The four calls of the import screen. Each answers the data or the problem, and never throws: a
// network failure is a problem with status 0.

export type Answer<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem };

const NETWORK: ApiProblem = { status: 0, code: null, issuePaths: [], retryAfterSeconds: 0 };

const base = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}/imports`;

async function answer<T>(request: () => Promise<Response>): Promise<Answer<T>> {
  try {
    const response = await request();
    if (!response.ok) return { ok: false, problem: await readProblem(response) };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, problem: NETWORK };
  }
}

/** Uploads the file (multipart; the browser sets `Origin` and the boundary). */
export function uploadStatement(poolId: string, form: FormData): Promise<Answer<ImportStart>> {
  return answer(() =>
    fetch(base(poolId), { method: 'POST', credentials: 'same-origin', body: form }),
  );
}

/** The preview of a pending batch again, for the chosen account. */
export function fetchPreview(
  poolId: string,
  batchId: string,
  accountId: string,
): Promise<Answer<ImportPreview>> {
  const query = new URLSearchParams({ accountId });
  return answer(() =>
    fetch(`${base(poolId)}/${encodeURIComponent(batchId)}?${query.toString()}`, {
      credentials: 'same-origin',
    }),
  );
}

export function commitStatement(
  poolId: string,
  batchId: string,
  body: unknown,
): Promise<Answer<ImportCommitResult>> {
  return answer(() =>
    fetch(`${base(poolId)}/${encodeURIComponent(batchId)}/commit`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** Drops a pending batch; the answer does not matter to the screen. */
export async function discardStatement(poolId: string, batchId: string): Promise<void> {
  try {
    await fetch(`${base(poolId)}/${encodeURIComponent(batchId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    // A pending batch nobody commits is harmless.
  }
}

export type ImportProblemKey =
  | 'tooLarge'
  | 'unsupported'
  | 'unrecognized'
  | 'rateLimited'
  | 'forbidden'
  | 'settled'
  | 'invalid'
  | 'network'
  | 'generic';

/** The message of `imports.errors` for a failed answer. */
export function importProblemKey(problem: ApiProblem): ImportProblemKey {
  switch (problem.status) {
    case 0:
      return 'network';
    case 400:
      return 'invalid';
    case 403:
      return 'forbidden';
    case 409:
      return 'settled';
    case 413:
      return 'tooLarge';
    case 415:
      return 'unsupported';
    case 422:
      return 'unrecognized';
    case 429:
      return 'rateLimited';
    default:
      return 'generic';
  }
}
