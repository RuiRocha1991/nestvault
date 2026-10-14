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
