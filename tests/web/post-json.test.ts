import { describe, expect, it } from 'vitest';

import { readOutcome } from '@webapp/lib/post-json';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('readOutcome', () => {
  it('does not read the body of a success', async () => {
    const response = json({ code: 'IGNORED' });
    expect(await readOutcome(response)).toEqual({
      ok: true,
      status: 200,
      code: null,
      retryAfter: null,
    });
    expect(response.bodyUsed).toBe(false);
  });

  it('returns the error code and Retry-After of a failure', async () => {
    const outcome = await readOutcome(
      json({ code: 'PASSWORD_BREACHED' }, { status: 429, headers: { 'Retry-After': '30' } }),
    );
    expect(outcome).toEqual({
      ok: false,
      status: 429,
      code: 'PASSWORD_BREACHED',
      retryAfter: '30',
    });
  });

  it.each([
    ['an empty body', new Response(null, { status: 500 })],
    ['a body that is not JSON', new Response('<html>', { status: 502 })],
    ['a null body', json(null, { status: 400 })],
    ['a code that is not a string', json({ code: 42 }, { status: 400 })],
  ])('gives a null code for %s', async (_name, response) => {
    expect((await readOutcome(response)).code).toBeNull();
  });
});
