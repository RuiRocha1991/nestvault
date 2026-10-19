import { FxDto, SettingsDto, UpdateSettingsInput } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Pool settings and FX (PRD 04). Guards in the service: session, input validation, membership
// (404 for non-members), permission (`pool.read` to read, `settings.write` to change), then
// `withPool` (RLS). A change is audited (`settings.updated`, how many fields, never the values).
// `fx_rates` itself is global and read-only for the application.

const PoolId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/settings',
  operationId: 'getPoolSettings',
  summary: 'Pool settings',
  description:
    'The defaults (transfer window 3 days, deposit and dividend tax 28 %, EUR, no FX override) while the pool never saved any. Any member may read.',
  tags: ['Settings'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The settings', ...json(SettingsDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/settings',
  operationId: 'updatePoolSettings',
  summary: 'Change the pool settings',
  description:
    'Needs `settings.write` (owner, admin). Fields left out stay; `fxOverrides` replaces the whole map (`{}` removes every override). Percentages are decimal strings from 0 to 100 with up to 4 decimals; rates are positive decimal strings with up to 8 decimals; EUR has no rate. The body is strict: `poolId` or any other field answers 400.',
  tags: ['Settings'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(UpdateSettingsInput) },
  },
  responses: {
    200: { description: 'The settings after the change', ...json(SettingsDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/fx',
  operationId: 'getPoolFx',
  summary: 'EUR rates the pool uses',
  description:
    'For every known currency: the pool’s own override, else the newest market rate dated on or before `asOf`, else the seed constant. `marketRate` is the rate without the override. Any member may read.',
  tags: ['Settings'],
  request: {
    params: z.object({ poolId: PoolId }),
    query: z.object({ asOf: z.iso.date().optional() }),
  },
  responses: {
    200: { description: 'The rates', ...json(FxDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});
