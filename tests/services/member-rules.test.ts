import { describe, expect, it } from 'vitest';

import { ROLES } from '@nestvault/db';
import type { Role } from '@nestvault/db';
import {
  canActOnMember,
  canAssignRole,
  canAssignRoleAs,
  HANDOVER_ROLES,
  holdsOwnerRights,
  leavesNoOwner,
  sameRole,
} from '@nestvault/services';

import { asMember, createPool } from '../support/factories';

const person = (userId: string, role: Role) => ({ userId, role });
const ME = 'me';
const OTHER = 'other';

describe('holdsOwnerRights', () => {
  it('is true for the owner role only, asked through the permission table', () => {
    expect(ROLES.filter((role) => holdsOwnerRights(role))).toEqual(['owner']);
  });
});

describe('HANDOVER_ROLES', () => {
  it('hands the pool to an owner and steps the giver down to a role without it', () => {
    expect(holdsOwnerRights(HANDOVER_ROLES.incoming)).toBe(true);
    expect(holdsOwnerRights(HANDOVER_ROLES.outgoing)).toBe(false);
  });
});

describe('sameRole', () => {
  it('compares two roles', () => {
    expect(sameRole('admin', 'admin')).toBe(true);
    expect(sameRole('admin', 'member')).toBe(false);
  });
});

describe('canAssignRoleAs', () => {
  it('agrees with canAssignRole for every caller role and every target role', () => {
    const pool = createPool();
    for (const actor of ROLES) {
      for (const role of ROLES) {
        expect(canAssignRoleAs(actor, role), `${actor} -> ${role}`).toBe(
          canAssignRole(asMember(pool, actor), role),
        );
      }
    }
  });
});

describe('canActOnMember', () => {
  it.each([
    ['owner', 'owner', true],
    ['owner', 'admin', true],
    ['owner', 'member', true],
    ['owner', 'viewer', true],
    ['admin', 'owner', false],
    ['admin', 'admin', true],
    ['admin', 'member', true],
    ['admin', 'viewer', true],
    ['member', 'viewer', false],
    ['viewer', 'member', false],
  ] as const)('%s acting on a %s: %s', (actor, target, expected) => {
    expect(canActOnMember(person(ME, actor), person(OTHER, target))).toBe(expected);
  });

  it('never lets anybody act on themselves, not even an owner', () => {
    for (const role of ROLES) {
      expect(canActOnMember(person(ME, role), person(ME, role)), role).toBe(false);
    }
  });
});

describe('leavesNoOwner', () => {
  const sole = [person(ME, 'owner'), person('a', 'admin'), person('b', 'member')];
  const two = [person(ME, 'owner'), person(OTHER, 'owner'), person('b', 'member')];

  it('is true when the only owner is removed or demoted', () => {
    expect(leavesNoOwner(sole, person(ME, 'owner'), null)).toBe(true);
    expect(leavesNoOwner(sole, person(ME, 'owner'), 'admin')).toBe(true);
    expect(leavesNoOwner(sole, person(ME, 'owner'), 'viewer')).toBe(true);
  });

  it('is false while another owner remains', () => {
    expect(leavesNoOwner(two, person(ME, 'owner'), null)).toBe(false);
    expect(leavesNoOwner(two, person(ME, 'owner'), 'admin')).toBe(false);
  });

  it('is false when the member is not an owner or stays one', () => {
    expect(leavesNoOwner(sole, person('a', 'admin'), null)).toBe(false);
    expect(leavesNoOwner(sole, person('b', 'member'), 'viewer')).toBe(false);
    expect(leavesNoOwner(sole, person(ME, 'owner'), 'owner')).toBe(false);
  });
});
