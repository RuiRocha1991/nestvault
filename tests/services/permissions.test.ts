import { describe, expect, it } from 'vitest';

import { ROLES } from '@nestvault/db';
import type { Role } from '@nestvault/db';
import {
  can,
  canAssignRole,
  ForbiddenError,
  PERMISSIONS,
  permissionsFor,
  permissionsOfRole,
  ROLE_PERMISSIONS,
  systemContext,
} from '@nestvault/services';
import type { Permission } from '@nestvault/services';

import { asMember, createPool } from '../support/factories';

// PRD 01 "Roles in v1", written out row by row. Columns: owner, admin, member, viewer.
const PRD_MATRIX: Record<Permission, readonly [boolean, boolean, boolean, boolean]> = {
  'pool.read': [true, true, true, true],
  'transactions.write': [true, true, true, false],
  'ops.write': [true, true, true, false],
  'prices.write': [true, true, true, false],
  'notes.write': [true, true, true, false],
  'imports.run': [true, true, true, false],
  'accounts.write': [true, true, false, false],
  'portfolios.write': [true, true, false, false],
  'categories.write': [true, true, false, false],
  'goals.write': [true, true, false, false],
  'members.invite': [true, true, false, false],
  'members.manage': [true, true, false, false], // admin: not owners (members service, NES-28)
  'pool.delete': [true, false, false, false],
  // Not in the PRD table: only the owner changes the household's name (NES-137).
  'pool.rename': [true, false, false, false],
  'pool.transfer': [true, false, false, false],
  'pool.export': [true, false, false, false],
  // Not in the PRD table: loading the prototype's backup writes a whole pool at once (NES-47).
  'pool.import': [true, false, false, false],
  // Not in the PRD table: pool settings are a management action, so owner and admin.
  'settings.write': [true, true, false, false],
  // Not in the PRD table: the audit log shows who did what, so only the owner reads it (NES-29).
  'audit.read': [true, false, false, false],
};

const ROLE_ORDER: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

describe('permission matrix (PRD 01)', () => {
  it('covers exactly the permission catalogue and the roles', () => {
    expect(Object.keys(PRD_MATRIX).sort()).toEqual([...PERMISSIONS].sort());
    expect([...ROLE_ORDER].sort()).toEqual([...ROLES].sort());
  });

  it.each(ROLE_ORDER.map((role, column) => [role, column] as const))(
    'grants %s exactly what the PRD table says',
    (role, column) => {
      const expected = PERMISSIONS.filter((permission) => PRD_MATRIX[permission][column]);
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...expected].sort());
      expect(permissionsOfRole(role)).toBe(ROLE_PERMISSIONS[role]);
    },
  );
});

describe('can', () => {
  const pool = createPool();

  it('lets a role use what it holds and throws ForbiddenError (403) otherwise', () => {
    const viewer = asMember(pool, 'viewer', { permissions: [...permissionsOfRole('viewer')] });
    expect(() => {
      can(viewer, 'pool.read');
    }).not.toThrow();
    for (const permission of ['accounts.write', 'transactions.write', 'imports.run'] as const) {
      expect(() => {
        can(viewer, permission);
      }).toThrow(ForbiddenError);
    }
    expect(new ForbiddenError().status).toBe(403);
  });

  it('keeps an admin away from owner-only actions', () => {
    const admin = asMember(pool, 'admin', { permissions: [...permissionsOfRole('admin')] });
    expect(() => {
      can(admin, 'members.manage');
    }).not.toThrow();
    expect(() => {
      can(admin, 'pool.delete');
    }).toThrow(ForbiddenError);
  });

  it('accepts a resource and ignores it for now', () => {
    const member = asMember(pool, 'member', { permissions: [...permissionsOfRole('member')] });
    expect(() => {
      can(member, 'transactions.write', { type: 'account', id: 'anything' });
    }).not.toThrow();
    expect(() => {
      can(member, 'accounts.write', { type: 'account', id: 'anything' });
    }).toThrow(ForbiddenError);
  });
});

describe('permissionsFor', () => {
  it('lists the permissions of the caller for the UI, in catalogue order, and nothing else', () => {
    const ctx = asMember(createPool(), 'member', {
      permissions: [...permissionsOfRole('member'), 'something.unknown'],
    });
    expect([...permissionsFor(ctx)]).toEqual(
      PERMISSIONS.filter((permission) => permissionsOfRole('member').has(permission)),
    );
  });
});

describe('systemContext', () => {
  it('acts as the system with exactly the permissions it is given', () => {
    const { poolId } = createPool();
    const ctx = systemContext(poolId, ['pool.read', 'imports.run']);
    expect(ctx.actor).toEqual({ kind: 'system' });
    expect(ctx.role).toBe('system');
    expect(ctx.poolId).toBe(poolId);
    expect([...ctx.permissions].sort()).toEqual(['imports.run', 'pool.read']);
    expect(() => {
      can(ctx, 'imports.run');
    }).not.toThrow();
    expect(() => {
      can(ctx, 'pool.delete');
    }).toThrow(ForbiddenError);
  });

  it('refuses a malformed pool id', () => {
    expect(() => systemContext('not-a-uuid', ['pool.read'])).toThrow(TypeError);
  });
});

describe('canAssignRole', () => {
  const pool = createPool();
  const grants: Record<Role, readonly Role[]> = {
    owner: ['owner', 'admin', 'member', 'viewer'],
    admin: ['admin', 'member', 'viewer'],
    member: [],
    viewer: [],
  };

  it.each(ROLE_ORDER)('lets %s hand out roles up to its own and never above', (role) => {
    const ctx = asMember(pool, role, { permissions: [...permissionsOfRole(role)] });
    for (const target of ROLE_ORDER) {
      expect(canAssignRole(ctx, target), `${role} -> ${target}`).toBe(
        grants[role].includes(target),
      );
    }
  });

  it('never lets background work hand out a role', () => {
    const ctx = systemContext(pool.poolId, [...PERMISSIONS]);
    for (const target of ROLE_ORDER) expect(canAssignRole(ctx, target)).toBe(false);
  });
});
