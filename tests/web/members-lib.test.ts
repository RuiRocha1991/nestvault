import { describe, expect, it } from 'vitest';

import { problemKey, readProblem, transferBody } from '@webapp/lib/members-api';
import { remainingUntil } from '@webapp/lib/relative-time';
import { capabilitiesOf, diffCapabilities } from '@webapp/lib/role-capabilities';
import { SETTINGS_TABS } from '@webapp/lib/settings-tabs';

describe('capabilitiesOf', () => {
  it('lists the capabilities a permission set grants, in the order the dialog shows them', () => {
    expect(capabilitiesOf(['imports.run', 'pool.read', 'transactions.write'])).toEqual([
      'viewData',
      'movements',
      'imports',
    ]);
    expect(capabilitiesOf([])).toEqual([]);
    expect(capabilitiesOf(['pool.delete', 'audit.read'])).toEqual([]);
  });
});

describe('diffCapabilities', () => {
  it('splits what a person keeps, loses and gains (mockup modal-75: admin to member)', () => {
    const admin = capabilitiesOf([
      'pool.read',
      'transactions.write',
      'imports.run',
      'accounts.write',
      'categories.write',
      'members.manage',
    ]);
    const member = capabilitiesOf(['pool.read', 'transactions.write', 'imports.run']);
    expect(diffCapabilities(admin, member)).toEqual({
      keep: ['viewData', 'movements', 'imports'],
      lose: ['structure', 'categories', 'people'],
      gain: [],
    });
    expect(diffCapabilities(member, admin).gain).toEqual(['structure', 'categories', 'people']);
  });
});

describe('remainingUntil', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('gives the time left in days, then hours, then minutes, and whether it is under two days', () => {
    expect(remainingUntil(at(5 * DAY + HOUR), now)).toEqual({ unit: 'day', count: 5, soon: false });
    expect(remainingUntil(at(DAY + HOUR), now)).toEqual({ unit: 'day', count: 1, soon: true });
    expect(remainingUntil(at(3 * HOUR + 60_000), now)).toEqual({
      unit: 'hour',
      count: 3,
      soon: true,
    });
    expect(remainingUntil(at(5 * 60_000), now)).toEqual({ unit: 'minute', count: 5, soon: true });
    expect(remainingUntil(at(10_000), now)).toEqual({ unit: 'minute', count: 1, soon: true });
  });

  it('is null once the time has passed', () => {
    expect(remainingUntil(at(0), now)).toBeNull();
    expect(remainingUntil(at(-HOUR), now)).toBeNull();
  });
});

describe('readProblem and problemKey', () => {
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

  it('reads the code, the fields named and the pause of a failed answer', async () => {
    const problem = await readProblem(
      answer(
        400,
        { error: { code: 'validation_error', issues: [{ path: 'password', message: 'x' }] } },
        { 'Retry-After': '90' },
      ),
    );
    expect(problem).toMatchObject({
      status: 400,
      code: 'validation_error',
      issuePaths: ['password'],
      retryAfterSeconds: 90,
    });
  });

  it('never throws on a body that is not the public error shape', async () => {
    expect(await readProblem(answer(500, 'not json'))).toMatchObject({
      status: 500,
      code: null,
      issuePaths: [],
    });
    expect(await readProblem(answer(409, { error: { issues: 'x' } }))).toMatchObject({
      issuePaths: [],
    });
  });

  it('maps the status to the message of the dialog', () => {
    const key = (status: number) =>
      problemKey({ status, code: null, issuePaths: [], retryAfterSeconds: 0 });
    expect(key(403)).toBe('forbidden');
    expect(key(404)).toBe('missing');
    expect(key(409)).toBe('lastOwner');
    expect(key(0)).toBe('error');
    expect(key(500)).toBe('error');
  });
});

describe('settings tabs', () => {
  it('has the members tab available for every member (the services decide what they may do)', () => {
    const members = SETTINGS_TABS.find((tab) => tab.key === 'members');
    expect(members).toMatchObject({ path: '/membros', available: true });
    expect(members?.requires).toBeUndefined();
  });
});

describe('transferBody', () => {
  const input = { userId: '0192f3a1-0000-7000-8000-000000000002', password: 'secret-passphrase' };

  it('stays out of the body unless the caller chose to remain an owner', () => {
    expect(transferBody({ ...input, keepOwnership: false })).toEqual(input);
    expect(transferBody({ ...input, keepOwnership: false })).not.toHaveProperty('keepOwnership');
  });

  it('sends keepOwnership: true when the caller stays an owner', () => {
    expect(transferBody({ ...input, keepOwnership: true })).toEqual({
      ...input,
      keepOwnership: true,
    });
  });
});
