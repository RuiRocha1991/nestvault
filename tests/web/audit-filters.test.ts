import { describe, expect, it } from 'vitest';

import {
  AUDIT_PAGE_SIZE,
  auditQuery,
  auditSearch,
  parseAuditFilters,
  type AuditFilters,
} from '@webapp/lib/audit-filters';

const vocabulary = {
  actions: ['member.removed', 'invite.created', 'auth.signin_failed'],
  categories: ['member', 'invite', 'auth'],
};
const TODAY = '2026-10-14';
const PERSON = '0192f3a1-0000-7000-8000-00000000c41e';

const parse = (params: Record<string, string | string[] | undefined>) =>
  parseAuditFilters(params, vocabulary, TODAY);

describe('parseAuditFilters', () => {
  it('defaults to the last 30 days, everyone, every action, first page', () => {
    expect(parse({})).toEqual({
      action: null,
      person: null,
      range: '30',
      from: '2026-09-14',
      to: TODAY,
      page: 1,
    });
  });

  it('reads the presets', () => {
    expect(parse({ range: '7' })).toMatchObject({ range: '7', from: '2026-10-07', to: TODAY });
    expect(parse({ range: 'all' })).toMatchObject({ range: 'all', from: null, to: null });
    expect(parse({ range: '90' })).toMatchObject({ range: '30' });
  });

  it('reads a custom period, open on one side, and puts a swapped one in order', () => {
    expect(parse({ from: '2026-09-01', to: '2026-09-30' })).toMatchObject({
      range: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(parse({ from: '2026-09-01' })).toMatchObject({
      range: 'custom',
      from: '2026-09-01',
      to: null,
    });
    expect(parse({ from: '2026-09-30', to: '2026-09-01' })).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('drops anything unknown or malformed instead of failing', () => {
    const filters = parse({
      action: "x' OR 1=1 --",
      person: 'not-a-uuid',
      from: '2026-02-30',
      to: 'yesterday',
      page: '-3',
    });
    expect(filters).toEqual(parse({}));
    expect(parse({ page: '2.5' }).page).toBe(1);
    expect(parse({ page: '99999' }).page).toBe(1);
  });

  it('accepts one action code or one category, a person and a page', () => {
    expect(parse({ action: 'member.removed' }).action).toBe('member.removed');
    expect(parse({ action: 'member' }).action).toBe('member');
    expect(parse({ person: PERSON.toUpperCase() }).person).toBe(PERSON);
    expect(parse({ page: '3' }).page).toBe(3);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parse({ action: ['invite.created', 'member.removed'] }).action).toBe('invite.created');
  });
});

describe('auditSearch', () => {
  it('leaves the defaults out', () => {
    expect(auditSearch(parse({}))).toBe('');
  });

  it('writes what differs and reads it back unchanged', () => {
    const filters: AuditFilters = {
      action: 'member',
      person: PERSON,
      range: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
      page: 2,
    };
    const query = auditSearch(filters);
    expect(query).toBe(`action=member&person=${PERSON}&from=2026-09-01&to=2026-09-30&page=2`);
    expect(parse(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
    expect(auditSearch(parse({ range: '7' }))).toBe('range=7');
    expect(auditSearch(parse({ range: 'all' }))).toBe('range=all');
  });
});

describe('auditQuery', () => {
  it('sends an action code as `action` and a category as `category`', () => {
    expect(auditQuery(parse({ action: 'member.removed' }))).toMatchObject({
      action: 'member.removed',
    });
    const byCategory = auditQuery(parse({ action: 'member' }));
    expect(byCategory).toMatchObject({ category: 'member' });
    expect(byCategory).not.toHaveProperty('action');
  });

  it('turns the days into Lisbon day boundaries, the last day included', () => {
    const query = auditQuery(parse({ from: '2026-07-01', to: '2026-07-15' }));
    expect(query).toMatchObject({
      from: '2026-06-30T23:00:00.000Z',
      to: '2026-07-15T23:00:00.000Z',
      limit: AUDIT_PAGE_SIZE,
      page: 1,
    });
  });

  it('has no dates for "all" and passes the person as `userId`', () => {
    const query = auditQuery(parse({ range: 'all', person: PERSON, page: '2' }));
    expect(query).toEqual({ limit: AUDIT_PAGE_SIZE, page: 2, userId: PERSON });
  });
});
