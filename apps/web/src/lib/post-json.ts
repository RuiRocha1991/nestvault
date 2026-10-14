/** POST a JSON body to a same-origin endpoint with the session cookie (the browser adds `Origin`). */
export function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

/** Same as `postJson` for other methods (PATCH, DELETE); without a body for DELETE. */
export function sendJson(
  method: 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

/** What the forms need from an API answer: status, the error `code` of the body and `Retry-After`. */
export interface ApiOutcome {
  ok: boolean;
  status: number;
  /** `code` of the JSON error body; null for a success or a body that is not JSON. */
  code: string | null;
  retryAfter: string | null;
}

/** Reads the answer once. The body is only parsed for a failure, and never throws. */
export async function readOutcome(response: Response): Promise<ApiOutcome> {
  const body = response.ok
    ? null
    : ((await response.json().catch(() => null)) as { code?: unknown } | null);
  return {
    ok: response.ok,
    status: response.status,
    code: typeof body?.code === 'string' ? body.code : null,
    retryAfter: response.headers.get('Retry-After'),
  };
}
