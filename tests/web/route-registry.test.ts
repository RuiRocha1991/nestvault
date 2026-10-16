import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@nestvault/services';

import {
  API_ROOT,
  compareWithRegistry,
  exportedMethods,
  listHandlers,
  pathOfDir,
  routesWithUnsupportedReexports,
  unsupportedReexports,
} from '../support/route-files';
import { keyOf, ROUTE_REGISTRY } from '../support/route-registry';

// The static half of the isolation suite (NES-30): a Route Handler under `app/api/v1` that is not in
// the registry fails CI, so a new route cannot skip the generated authorization and isolation cases
// (tests/web/route-isolation.integration.test.ts).

const registered = ROUTE_REGISTRY.map(keyOf);

describe('route registry', () => {
  const onDisk = listHandlers();

  it('finds the handlers under app/api/v1', () => {
    expect(API_ROOT).toContain('apps/web/src/app/api/v1');
    expect(onDisk.length).toBeGreaterThanOrEqual(15);
    expect(onDisk.map((handler) => handler.key)).toContain('GET /api/v1/pools/:poolId/members');
  });

  it('has an entry for every Route Handler and none for a handler that no longer exists', () => {
    const { unregistered, stale } = compareWithRegistry(onDisk, registered);
    expect(
      unregistered,
      'add these to tests/support/route-registry.ts (see docs/testing.md)',
    ).toEqual([]);
    expect(stale, 'remove these entries from tests/support/route-registry.ts').toEqual([]);
  });

  it('has no route.ts that hides its handlers behind a re-export', () => {
    expect(
      routesWithUnsupportedReexports(),
      'declare the handlers in route.ts itself (`export const GET = …`)',
    ).toEqual([]);
  });

  it('lists every handler once', () => {
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('gives every exempt route a reason and every pool route a real permission', () => {
    for (const spec of ROUTE_REGISTRY) {
      if (spec.scope === 'exempt') {
        expect(spec.reason.length, keyOf(spec)).toBeGreaterThan(30);
      } else if (spec.scope === 'pool') {
        expect(PERMISSIONS, keyOf(spec)).toContain(spec.permission);
        expect(spec.path, keyOf(spec)).toContain('/pools/:poolId');
      } else {
        expect(spec.path, keyOf(spec)).not.toContain(':poolId');
      }
    }
  });

  it('asks for a foreign resource, or the reason there is none, on every protected route', () => {
    for (const spec of ROUTE_REGISTRY) {
      if (spec.scope === 'exempt') continue;
      const reason = spec.noForeignBecause ?? '';
      expect(spec.foreign !== undefined || reason.length > 20, keyOf(spec)).toBe(true);
    }
  });

  it('loads the route file of every entry and finds its method there', async () => {
    for (const spec of ROUTE_REGISTRY) {
      const module = await spec.load();
      expect(typeof module[spec.method], keyOf(spec)).toBe('function');
    }
  });
});

describe('static detection of Route Handlers', () => {
  it('turns folders into URL templates', () => {
    expect(pathOfDir('pools/[poolId]/invites/[id]/resend')).toBe(
      '/api/v1/pools/:poolId/invites/:id/resend',
    );
    expect(pathOfDir('auth/[...all]')).toBe('/api/v1/auth/*');
    expect(pathOfDir('health')).toBe('/api/v1/health');
  });

  it('reads the methods a route file exports, in every spelling', () => {
    expect(
      exportedMethods(`
        export const GET = route(async () => x);
        export async function POST() {}
        export const dynamic = 'force-dynamic';
        const handle = route(y);
        export { handle as DELETE, handle as PATCH };
        export const getHelper = 1;
      `),
    ).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
  });

  it('recognises the re-export forms it cannot follow', () => {
    expect(unsupportedReexports("export * from './handlers';")).toEqual(['export * from']);
    expect(unsupportedReexports("export * as all from './handlers';")).toEqual(['export * from']);
    expect(unsupportedReexports("export { GET, POST } from './handlers';")).toEqual([
      'export { … } from',
    ]);
    expect(unsupportedReexports("export type { Shape } from './types';")).toEqual([
      'export { … } from',
    ]);
    expect(unsupportedReexports('const handle = route(x);\nexport { handle as GET };')).toEqual([]);
    expect(unsupportedReexports('export const GET = route(x);')).toEqual([]);
  });

  it('reports a new handler that is not in the registry (the CI failure this check exists for)', () => {
    const withNewRoute = [...listHandlers(), { key: 'POST /api/v1/pools/:poolId/accounts' }];
    expect(compareWithRegistry(withNewRoute, registered)).toEqual({
      unregistered: ['POST /api/v1/pools/:poolId/accounts'],
      stale: [],
    });
  });

  it('reports a registry entry whose handler was removed', () => {
    const withoutOne = listHandlers().filter((handler) => handler.key !== 'GET /api/v1/health');
    expect(compareWithRegistry(withoutOne, registered)).toEqual({
      unregistered: [],
      stale: ['GET /api/v1/health'],
    });
  });
});
