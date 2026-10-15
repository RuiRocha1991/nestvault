import { describe, expect, it } from 'vitest';

import {
  avatarColor,
  CATEGORY_TONE,
  shortCode,
  shortId,
  splitAction,
} from '@webapp/lib/audit-view';
import { SETTINGS_TABS, settingsPath } from '@webapp/lib/settings-tabs';

describe('splitAction', () => {
  it('gives the category and the camelCase message key of an action code', () => {
    expect(splitAction('member.role_changed')).toEqual({ category: 'member', name: 'roleChanged' });
    expect(splitAction('auth.signin')).toEqual({ category: 'auth', name: 'signin' });
    expect(splitAction('pool.ownership_transferred')).toEqual({
      category: 'pool',
      name: 'ownershipTransferred',
    });
  });

  it('copes with a code it does not know', () => {
    expect(splitAction('weird')).toEqual({ category: 'weird', name: '' });
    expect(splitAction('')).toEqual({ category: '', name: '' });
  });
});

describe('small helpers', () => {
  it('picks the same avatar colour for the same person every time', () => {
    const id = '0192f3a1-0000-7000-8000-00000000c41e';
    expect(avatarColor(id)).toBe(avatarColor(id));
    expect(avatarColor(id)).toMatch(/^var\(--c-[a-z]+\)$/);
  });

  it('shortens ids for the screen', () => {
    expect(shortCode('3f9a1c2e-0000')).toBe('3f9a');
    expect(shortId('0192f3a1-0000-7000-8000-00000000c41e')).toBe('0192f3a…c41e');
  });

  it('has a tone for every category the log groups by', () => {
    expect(Object.keys(CATEGORY_TONE).sort()).toEqual([
      'auth',
      'invite',
      'member',
      'pool',
      'session',
    ]);
  });
});

describe('settings tabs', () => {
  it('lists the four tabs in order, the audit one for owners only', () => {
    expect(SETTINGS_TABS.map((tab) => tab.key)).toEqual(['params', 'plan', 'members', 'audit']);
    expect(
      SETTINGS_TABS.filter((tab) => tab.requires).map((tab) => [tab.key, tab.requires]),
    ).toEqual([['audit', 'audit.read']]);
  });

  it('builds the path of a tab below the pool', () => {
    const [params, , , audit] = SETTINGS_TABS;
    expect(params && settingsPath('pool-1', params)).toBe('/pool-1/definicoes');
    expect(audit && settingsPath('pool-1', audit)).toBe('/pool-1/definicoes/auditoria');
  });
});
