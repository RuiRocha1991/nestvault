import { describe, expect, it } from 'vitest';

import { CENSOR, createLogger, serializeError } from '@nestvault/services';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => void lines.push(JSON.parse(line) as never) },
  });
  return { logger, lines };
}

const VARIANTS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'access_token',
  'refresh_token',
  'secret',
  'clientSecret',
  'session',
  'cookie',
  'Set-Cookie',
  'authorization',
  'Authorization',
  'x-api-key',
  'iban',
  'IBAN',
  'email',
  'Email',
  'amount',
  'balance',
  'note',
  'notes',
  'body',
  'description',
];

describe('logger redaction (security control 15)', () => {
  it.each(VARIANTS)('censors %s at the top level and when nested', (key) => {
    const { logger, lines } = capture();
    logger.info(
      { [key]: 'secret-value', req: { [key]: 'secret-value', a: { [key]: 'secret-value' } } },
      'x',
    );
    const text = JSON.stringify(lines);
    expect(text).not.toContain('secret-value');
    expect(lines[0]).toMatchObject({ [key]: CENSOR });
  });

  it('censors a key nested deeper than any fixed path list would reach, and inside arrays', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        a: { b: { c: { d: { e: { f: { password: 'secret-value' } } } } } },
        list: [{ iban: 'secret-value' }],
      },
      'x',
    );
    expect(JSON.stringify(lines)).not.toContain('secret-value');
  });

  it('censors what is too deep to inspect and survives circular objects', () => {
    const { logger, lines } = capture();
    let deep: Record<string, unknown> = { leaf: 'secret-value' };
    for (let i = 0; i < 30; i++) deep = { next: deep };
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    logger.info({ deep, loop }, 'x');
    expect(JSON.stringify(lines)).not.toContain('secret-value');
    expect(lines[0]).toMatchObject({ loop: { name: 'loop', self: '[Circular]' } });
  });

  it('censors child bindings as well', () => {
    const { logger, lines } = capture();
    logger.child({ request_id: 'r1', accessToken: 'secret-value' }).info('x');
    expect(JSON.stringify(lines)).not.toContain('secret-value');
    expect(lines[0]).toMatchObject({ request_id: 'r1' });
  });

  it('keeps harmless fields and the ids used to follow a request', () => {
    const { logger, lines } = capture();
    logger.child({ request_id: 'r1', user_id: 'u1', pool_id: 'p1' }).info({ status: 200 }, 'done');
    expect(lines[0]).toMatchObject({
      level: 'info',
      request_id: 'r1',
      user_id: 'u1',
      pool_id: 'p1',
      status: 200,
      msg: 'done',
    });
    expect(lines[0]).not.toHaveProperty('pid');
    expect(lines[0]).not.toHaveProperty('hostname');
  });

  it('logs an error with its stack frames but never its message', () => {
    const { logger, lines } = capture();
    const error = new Error('insert into transactions (amount, note) values (1234.56, "rent")');
    logger.error({ err: error }, 'unhandled error');
    const text = JSON.stringify(lines);
    expect(text).not.toContain('1234.56');
    expect(text).not.toContain('rent');
    expect(lines[0]).toMatchObject({ err: { type: 'Error' } });
    expect((lines[0]?.err as { stack: string }).stack).toContain('at ');
  });
});

describe('serializeError', () => {
  it('keeps the database error code, also from the cause', () => {
    const cause = Object.assign(new Error('boom 12.5'), { code: '23505' });
    const wrapped = new Error('Failed query: params 12.5', { cause });
    expect(serializeError(wrapped)).toMatchObject({ type: 'Error', causeCode: '23505' });
    expect(JSON.stringify(serializeError(wrapped))).not.toContain('12.5');
  });

  it('handles values that are not errors', () => {
    expect(serializeError('text with 99.9')).toEqual({ type: 'string' });
  });
});
