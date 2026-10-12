import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ConflictError,
  createLogger,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { assertSameOrigin } from '../../apps/web/src/server/api/origin';
import { readJson } from '../../apps/web/src/server/api/read-json';
import { route, type RouteHandler } from '../../apps/web/src/server/api/route';

const ORIGIN = 'http://localhost:4000';

function setup(handler: RouteHandler<Record<string, never>>) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => void lines.push(JSON.parse(line) as never) },
  });
  return { lines, handle: route(handler, { logger, appOrigin: () => ORIGIN }) };
}

function request(method = 'GET', init: { headers?: Record<string, string>; body?: BodyInit } = {}) {
  return new Request('http://localhost:4000/api/v1/thing?secret=1', { method, ...init });
}

const call = (handle: ReturnType<typeof setup>['handle'], req: Request) =>
  handle(req, { params: Promise.resolve({}) });

describe('route(): errors', () => {
  it('turns an unexpected error into the generic body; the log has the stack, the response none', async () => {
    const { handle, lines } = setup(() => {
      throw new Error('select * from accounts where iban = "PT50000201231234567890154"');
    });
    const response = await call(handle, request());
    const text = await response.text();
    expect(response.status).toBe(500);
    const body = JSON.parse(text) as {
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body.error).toEqual({
      code: 'internal_error',
      message: 'Something went wrong. Try again later.',
    });
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(text).not.toMatch(/PT50|select|stack|\bat /);

    const logged = lines.find((line) => line.msg === 'unhandled error');
    expect((logged?.err as { stack: string }).stack).toContain('at ');
    expect(logged?.request_id).toBe(body.requestId);
    expect(JSON.stringify(lines)).not.toContain('PT50');
  });

  it.each([
    [new ValidationError('bad input'), 400, 'validation_error'],
    [new UnauthorizedError(), 401, 'unauthorized'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new NotFoundError(), 404, 'not_found'],
    [new ConflictError(), 409, 'conflict'],
    [new PayloadTooLargeError(), 413, 'payload_too_large'],
  ])('maps %o to %i', async (error, status, code) => {
    const { handle } = setup(() => Promise.reject(error));
    const response = await call(handle, request());
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe(code);
    expect(body.requestId).toBeTruthy();
  });

  it('adds Retry-After to a 429', async () => {
    const { handle } = setup(() => Promise.reject(new RateLimitError(42)));
    const response = await call(handle, request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
  });

  it('turns a zod error into a 400 that names the fields, not the values', async () => {
    const { handle } = setup(() => {
      z.object({ name: z.string() }).strict().parse({ name: 5, poolId: 'x' });
      return Promise.resolve(new Response());
    });
    const response = await call(handle, request());
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues.map((issue) => issue.path)).toContain('name');
  });
});

describe('route(): request id, headers and access log', () => {
  it('generates an id, honours a safe incoming one and ignores a hostile one', async () => {
    const { handle } = setup(() => Promise.resolve(new Response('ok')));
    const generated = await call(handle, request());
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await call(
      handle,
      request('GET', { headers: { 'x-request-id': 'abc-12345678' } }),
    );
    expect(kept.headers.get('x-request-id')).toBe('abc-12345678');
    const hostile = await call(
      handle,
      request('GET', { headers: { 'x-request-id': 'a b "x" 1' } }),
    );
    expect(hostile.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.headers.get('cache-control')).toBe('no-store');
  });

  it('writes one access line with method, path (no query), status, duration and the actor', async () => {
    const { handle, lines } = setup((_req, ctx) => {
      ctx.setActor({ userId: 'u-1', poolId: 'p-1' });
      return Promise.resolve(new Response('ok'));
    });
    await call(handle, request());
    const access = lines.find((line) => line.msg === 'request');
    expect(access).toMatchObject({
      method: 'GET',
      path: '/api/v1/thing',
      status: 200,
      user_id: 'u-1',
      pool_id: 'p-1',
    });
    expect(typeof access?.duration_ms).toBe('number');
    expect(JSON.stringify(lines)).not.toContain('secret=1');
  });
});

describe('route(): response headers', () => {
  it('keeps the request id and the access log when the handler returns immutable headers', async () => {
    const { handle, lines } = setup(() =>
      Promise.resolve(Response.redirect('http://localhost:4000/x', 302)),
    );
    const response = await call(handle, request());
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:4000/x');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(lines.some((line) => line.msg === 'request' && line.status === 302)).toBe(true);
  });

  it('defaults to no-store but keeps the Cache-Control the handler chose', async () => {
    const { handle } = setup(() =>
      Promise.resolve(
        new Response('file', { headers: { 'Cache-Control': 'private, max-age=60' } }),
      ),
    );
    expect((await call(handle, request())).headers.get('cache-control')).toBe(
      'private, max-age=60',
    );
  });
});

describe('route(): same-origin check on writes', () => {
  const ok = () => Promise.resolve(new Response('done'));

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s from a foreign Origin gets 403',
    async (method) => {
      const { handle } = setup(ok);
      const response = await call(
        handle,
        request(method, { headers: { origin: 'https://evil.example' } }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    },
  );

  it('a write without Origin gets 403', async () => {
    const { handle } = setup(ok);
    expect((await call(handle, request('POST'))).status).toBe(403);
  });

  it('a write from the app origin goes through, and reads need no Origin', async () => {
    const { handle } = setup(ok);
    expect((await call(handle, request('POST', { headers: { origin: ORIGIN } }))).status).toBe(200);
    expect((await call(handle, request('GET'))).status).toBe(200);
  });

  it('does not accept a look-alike origin', () => {
    for (const origin of [`${ORIGIN}.evil.example`, 'http://localhost:4001', 'null', '']) {
      const req = new Request(ORIGIN, { method: 'POST', headers: { origin } });
      expect(() => {
        assertSameOrigin(req, ORIGIN);
      }, origin).toThrow(ForbiddenError);
    }
  });
});

describe('readJson', () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request(ORIGIN, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('parses a body within the limit', async () => {
    expect(await readJson(post('{"a":1}'), { maxBytes: 100 })).toEqual({ a: 1 });
  });

  it('rejects a body above the limit with 413, even when Content-Length lies', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(500) });
    await expect(readJson(post(big), { maxBytes: 100 })).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
    const lying = post(big, { 'content-length': '10' });
    await expect(readJson(lying, { maxBytes: 100 })).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('answers 413 through route()', async () => {
    const { handle } = setup(async (req) => Response.json(await readJson(req, { maxBytes: 50 })));
    const req = request('POST', {
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(200) }),
    });
    expect((await call(handle, req)).status).toBe(413);
  });

  it('accepts a charset parameter but not look-alike media types', async () => {
    const withCharset = post('{"a":1}', { 'content-type': 'Application/JSON; charset=utf-8' });
    expect(await readJson(withCharset, { maxBytes: 100 })).toEqual({ a: 1 });
    for (const type of ['application/jsonp', 'application/json-seq', 'application/jsonx']) {
      await expect(
        readJson(post('{}', { 'content-type': type }), { maxBytes: 100 }),
        type,
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('rejects malformed UTF-8 instead of parsing replacement characters', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    await expect(readJson(post(bytes), { maxBytes: 100 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects other content types and invalid JSON with 400', async () => {
    await expect(
      readJson(post('{}', { 'content-type': 'text/plain' }), { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(readJson(post('{nope'), { maxBytes: 100 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
