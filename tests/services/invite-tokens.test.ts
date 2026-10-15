import { describe, expect, it } from 'vitest';

import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  inviteLink,
  isInviteTokenShape,
} from '../../packages/services/src/invites/tokens';

describe('invite tokens', () => {
  it('are 256 random bits as 43 base64url characters, different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isInviteTokenShape(token)).toBe(true);
    }
  });

  it('are hashed with SHA-256 (hex) and the hash is not the token', () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(generateInviteToken()));
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it('recognise only what we issue, so nothing else reaches the database', () => {
    for (const bad of [
      '',
      'abc',
      "' OR 1=1 --",
      `${'A'.repeat(42)}!`,
      'A'.repeat(44),
      `../${'A'.repeat(40)}`,
      null,
      undefined,
      42,
    ]) {
      expect(isInviteTokenShape(bad)).toBe(false);
    }
  });

  it('are valid for seven days and link to /convite/<token> under the app origin', () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteLink('http://localhost:4000', 'abc-_')).toBe(
      'http://localhost:4000/convite/abc-_',
    );
  });
});
