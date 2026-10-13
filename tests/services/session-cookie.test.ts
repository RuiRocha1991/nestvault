import { describe, expect, it } from 'vitest';

import { hasSessionCookie } from '@nestvault/services';

const withCookie = (cookie?: string) => new Headers(cookie === undefined ? {} : { cookie });

describe('hasSessionCookie', () => {
  it.each([
    'nv.session_token=abc.def',
    'theme=dark; nv.session_token=abc.def',
    'nv.session_token=abc; nv-theme=light',
    '__Secure-nv.session_token=abc.def',
  ])('finds the session cookie in %j', (cookie) => {
    expect(hasSessionCookie(withCookie(cookie))).toBe(true);
  });

  it.each([
    undefined,
    '',
    'nv-theme=dark',
    'nv.session_token=', // cleared on sign-out
    'xnv.session_token=abc', // another cookie that merely ends the same way
    'other.nv.session_token=abc',
    'nvXsession_token=abc', // the dot is a literal dot
  ])('does not find one in %j', (cookie) => {
    expect(hasSessionCookie(withCookie(cookie))).toBe(false);
  });
});
