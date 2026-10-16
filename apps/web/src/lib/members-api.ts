import { parseRetryAfter } from '@webapp/lib/sign-in';

/** What the members dialogs need from a failed answer: the status, the field named and the pause. */
export interface ApiProblem {
  status: number;
  code: string | null;
  /** Paths of the validation issues (`password`), so a dialog can mark the right field. */
  issuePaths: readonly string[];
  /** Seconds the server asked the client to wait (429), or 0. */
  retryAfterSeconds: number;
}

interface ErrorBody {
  error?: { code?: unknown; issues?: unknown };
}

/** Reads a failed answer once. The body is the public `{ error: { code, issues? } }`; never throws. */
export async function readProblem(response: Response): Promise<ApiProblem> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  const issues = Array.isArray(body?.error?.issues) ? (body.error.issues as unknown[]) : [];
  return {
    status: response.status,
    code: typeof body?.error?.code === 'string' ? body.error.code : null,
    issuePaths: issues.flatMap((issue) => {
      const path = (issue as { path?: unknown } | null)?.path;
      return typeof path === 'string' ? [path] : [];
    }),
    retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
  };
}

/** The short message key a dialog shows for a failed answer (see `members.dialog`). */
export function problemKey(problem: ApiProblem): 'forbidden' | 'missing' | 'lastOwner' | 'error' {
  if (problem.status === 403) return 'forbidden';
  if (problem.status === 404) return 'missing';
  if (problem.status === 409) return 'lastOwner';
  return 'error';
}

/** The body of a transfer request: `keepOwnership` is only sent when the caller chose to stay an owner. */
export function transferBody(input: { userId: string; password: string; keepOwnership: boolean }): {
  userId: string;
  password: string;
  keepOwnership?: true;
} {
  const { userId, password, keepOwnership } = input;
  return keepOwnership ? { userId, password, keepOwnership: true } : { userId, password };
}
