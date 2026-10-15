import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  auditLogRepo,
  createIdentityDatabase,
  newId,
  poolMembersRepo,
  poolsRepo,
  usersRepo,
  type Role,
} from '@nestvault/db';
import {
  actionsOfCategory,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  createAuditService,
  createAuth,
  createMemoryEmailSender,
  createPoolsService,
  ForbiddenError,
  listAuditScreen,
  NotFoundError,
  permissionsOfRole,
  recordAudit,
  UnauthorizedError,
  ValidationError,
  type AuditService,
  type Auth,
  type PoolsService,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import { APP_URL, cookieOf, PASSWORD, postAuth, registerUser } from '../support/auth-harness';
import { asMember } from '../support/factories';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

const INJECTION = "' OR 1=1 --";

async function person(name: string): Promise<string> {
  return usersRepo.insertCredentialUser(identity.db, {
    name,
    email: `${newId()}@example.test`,
    passwordHash: 'not-a-real-hash',
  });
}

async function poolWith(members: readonly { userId: string; role: Role }[]): Promise<string> {
  const poolId = newId();
  await poolsRepo.insert(identity.db, { id: poolId, name: 'Casa' });
  for (const member of members) await poolMembersRepo.insert(identity.db, { poolId, ...member });
  return poolId;
}

const ctxOf = (poolId: string, userId: string, role: Role) =>
  asMember({ poolId }, role, {
    user: { id: userId, email: 'x@example.test', name: 'x' },
    permissions: [...permissionsOfRole(role)],
  });

beforeEach(async () => {
  await testDb.truncateAll();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('audit categories', () => {
  it('puts every action in exactly one category', () => {
    const grouped = AUDIT_CATEGORIES.flatMap((category) => actionsOfCategory(category));
    expect([...grouped].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
});

describe('listAuditScreen filters', () => {
  it('filters by person, by category and by action, and counts the matches', async () => {
    const ana = await person('Ana');
    const rui = await person('Rui');
    const poolId = await poolWith([
      { userId: rui, role: 'owner' },
      { userId: ana, role: 'member' },
    ]);
    const owner = ctxOf(poolId, rui, 'owner');
    await recordAudit(identity, ctxOf(poolId, ana, 'member'), 'invite.accepted');
    await recordAudit(identity, owner, 'invite.created');
    await recordAudit(identity, owner, 'member.removed');
    await recordAudit(identity, owner, 'member.role_changed');

    const byAna = await listAuditScreen(identity, owner, { userId: ana });
    expect(byAna.page.entries.map((entry) => entry.action)).toEqual(['invite.accepted']);
    expect(byAna.total).toBe(1);

    const members = await listAuditScreen(identity, owner, { category: 'member' });
    expect(members.page.entries.map((entry) => entry.action).sort()).toEqual([
      'member.removed',
      'member.role_changed',
    ]);
    expect(members.total).toBe(2);

    const one = await listAuditScreen(identity, owner, { action: 'invite.created', userId: rui });
    expect(one.total).toBe(1);
    const none = await listAuditScreen(identity, owner, { category: 'invite', userId: newId() });
    expect(none).toMatchObject({ total: 0, page: { entries: [] } });
  });

  it('pages by number: the total stays, the pages do not overlap, a page past the end is empty', async () => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role: 'owner' }]);
    const owner = ctxOf(poolId, rui, 'owner');
    for (let i = 0; i < 5; i += 1) await recordAudit(identity, owner, 'invite.created');

    const pages = [];
    for (const page of [1, 2, 3, 4]) {
      pages.push(await listAuditScreen(identity, owner, { limit: 2, page }));
    }
    expect(pages.map((screen) => screen.page.entries.length)).toEqual([2, 2, 1, 0]);
    expect(pages.map((screen) => screen.total)).toEqual([5, 5, 5, 5]);
    const ids = pages.flatMap((screen) => screen.page.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(5);
  });

  it.each([
    { action: 'invite.created', category: 'invite' },
    { page: 2, before: '2026-01-01T00:00:00.000Z|0192f3a1-0000-7000-8000-000000000000' },
    { page: 0 },
    { page: 10_001 },
    { category: 'nope' },
    { userId: 'not-a-uuid' },
    { userId: INJECTION },
    { category: INJECTION },
  ])('rejects the query %j', async (query) => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role: 'owner' }]);
    await expect(listAuditScreen(identity, ctxOf(poolId, rui, 'owner'), query)).rejects.toThrow(
      ValidationError,
    );
  });

  it.each(['admin', 'member', 'viewer'] as const)('answers 403 to a %s', async (role) => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role }]);
    await expect(listAuditScreen(identity, ctxOf(poolId, rui, role), {})).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('listAuditScreen names', () => {
  it('names the actors and targets on the page, including a person who left, and lists members', async () => {
    const rui = await person('Rui');
    const ana = await person('Ana');
    const gone = await person('Zé');
    const poolId = await poolWith([
      { userId: rui, role: 'owner' },
      { userId: ana, role: 'admin' },
    ]);
    const owner = ctxOf(poolId, rui, 'owner');
    await recordAudit(identity, owner, 'member.role_changed', {
      target: ana,
      meta: { previousRole: 'member', role: 'admin' },
    });
    // The person who left is no member any more, but their entry still shows their name.
    await recordAudit(identity, ctxOf(poolId, gone, 'member'), 'member.left');

    const screen = await listAuditScreen(identity, owner, {});
    const names = Object.fromEntries(screen.people.map((p) => [p.id, p.name]));
    expect(names).toEqual({ [rui]: 'Rui', [ana]: 'Ana', [gone]: 'Zé' });
    expect(screen.members.map((m) => m.name)).toEqual(['Ana', 'Rui']);
  });

  it("never names somebody who is not on the page, and never shows another pool's people", async () => {
    const rui = await person('Rui');
    const stranger = await person('Stranger');
    const mine = await poolWith([{ userId: rui, role: 'owner' }]);
    const other = await poolWith([{ userId: stranger, role: 'owner' }]);
    await recordAudit(identity, ctxOf(other, stranger, 'owner'), 'pool.created');
    await recordAudit(identity, ctxOf(mine, rui, 'owner'), 'pool.created');

    const screen = await listAuditScreen(identity, ctxOf(mine, rui, 'owner'), {});
    expect(screen.total).toBe(1);
    expect(JSON.stringify(screen)).not.toContain('Stranger');
    expect(screen.members).toEqual([{ id: rui, name: 'Rui' }]);
  });

  it('exposes no email', async () => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role: 'owner' }]);
    await recordAudit(identity, ctxOf(poolId, rui, 'owner'), 'pool.created');
    const screen = await listAuditScreen(identity, ctxOf(poolId, rui, 'owner'), {});
    expect(JSON.stringify(screen)).not.toContain('@example.test');
  });
});

describe('repositories treat input as data', () => {
  it('counts and lists with an injection payload as the action, finding nothing', async () => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role: 'owner' }]);
    await recordAudit(identity, ctxOf(poolId, rui, 'owner'), 'pool.created');

    expect(await auditLogRepo.countForPool(identity.db, poolId, { action: INJECTION })).toBe(0);
    expect(await auditLogRepo.countForPool(identity.db, poolId, { actions: [INJECTION] })).toBe(0);
    expect(
      await auditLogRepo.listForPool(identity.db, poolId, { limit: 5, action: INJECTION }),
    ).toEqual([]);
    expect(await auditLogRepo.countForPool(identity.db, poolId, {})).toBe(1);
  });

  it('binds the user id: a payload fails as a bad uuid and the table is intact', async () => {
    const rui = await person('Rui');
    const poolId = await poolWith([{ userId: rui, role: 'owner' }]);
    await recordAudit(identity, ctxOf(poolId, rui, 'owner'), 'pool.created');

    await expect(
      auditLogRepo.countForPool(identity.db, poolId, { userId: INJECTION }),
    ).rejects.toThrow();
    await expect(usersRepo.namesByIds(identity.db, [INJECTION])).rejects.toThrow();
    await expect(poolMembersRepo.listWithNames(identity.db, INJECTION)).rejects.toThrow();
    expect(await auditLogRepo.countForPool(identity.db, poolId, {})).toBe(1);
    expect(await usersRepo.namesByIds(identity.db, [rui])).toEqual([{ id: rui, name: 'Rui' }]);
  });

  it('looks up no names for an empty list of ids', async () => {
    expect(await usersRepo.namesByIds(identity.db, [])).toEqual([]);
  });
});

describe('AuditService and PoolsService.permissions', () => {
  let auth: Auth;
  let pools: PoolsService;
  let audit: AuditService;

  beforeEach(() => {
    auth = createAuth({
      identity,
      appUrl: APP_URL,
      secret: 'x'.repeat(40),
      allowSignup: true,
      email: createMemoryEmailSender(),
      trustedProxyHops: 1,
      checkBreached: () => Promise.resolve(false),
    });
    pools = createPoolsService({ auth, identity });
    audit = createAuditService({ auth, identity });
  });

  async function signedIn(email: string): Promise<{ headers: Headers; userId: string }> {
    await registerUser(auth, identity, email);
    const res = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
    const userId = await usersRepo.findIdByEmail(identity.db, email);
    return { headers: new Headers({ cookie: cookieOf(res) }), userId: userId ?? '' };
  }

  it('gives the owner the screen, and 401 / 400 / 404 / 403 to everybody else, in that order', async () => {
    const owner = await signedIn('owner@example.test');
    const member = await signedIn('member@example.test');
    const outsider = await signedIn('outsider@example.test');
    const { id: poolId } = await pools.create(owner.headers, { name: 'Casa' });
    await poolMembersRepo.insert(identity.db, { poolId, userId: member.userId, role: 'member' });

    const screen = await audit.screen(owner.headers, poolId, { category: 'pool' });
    expect(screen.page.entries.map((entry) => entry.action)).toEqual(['pool.created']);
    expect(screen.total).toBe(1);

    await expect(audit.screen(new Headers(), poolId, {})).rejects.toThrow(UnauthorizedError);
    await expect(audit.screen(owner.headers, poolId, { poolId })).rejects.toThrow(ValidationError);
    await expect(audit.screen(outsider.headers, poolId, {})).rejects.toThrow(NotFoundError);
    await expect(audit.screen(outsider.headers, 'not-a-uuid', {})).rejects.toThrow(NotFoundError);
    await expect(audit.screen(member.headers, poolId, {})).rejects.toThrow(ForbiddenError);
  });

  it('does not leak that a pool exists: a non-member gets the same error for a real and an unknown pool', async () => {
    const owner = await signedIn('owner@example.test');
    const outsider = await signedIn('outsider@example.test');
    const { id: poolId } = await pools.create(owner.headers, { name: 'Casa' });
    const real = await audit.screen(outsider.headers, poolId, {}).catch((error: unknown) => error);
    const unknown = await audit
      .screen(outsider.headers, newId(), {})
      .catch((error: unknown) => error);
    expect(real).toBeInstanceOf(NotFoundError);
    expect(unknown).toBeInstanceOf(NotFoundError);
    expect((real as Error).message).toBe((unknown as Error).message);
  });

  it('tells a page what the caller may do', async () => {
    const owner = await signedIn('owner@example.test');
    const viewer = await signedIn('viewer@example.test');
    const outsider = await signedIn('outsider@example.test');
    const { id: poolId } = await pools.create(owner.headers, { name: 'Casa' });
    await poolMembersRepo.insert(identity.db, { poolId, userId: viewer.userId, role: 'viewer' });

    expect(await pools.permissions(owner.headers, poolId)).toContain('audit.read');
    expect(await pools.permissions(viewer.headers, poolId)).toEqual(['pool.read']);
    await expect(pools.permissions(outsider.headers, poolId)).rejects.toThrow(NotFoundError);
    await expect(pools.permissions(new Headers(), poolId)).rejects.toThrow(UnauthorizedError);
  });
});
