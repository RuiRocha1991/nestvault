import { ImportPrototypeInput, ImportResultDto } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Import of the prototype's JSON export (NES-47). Guards in the service: session, strict body
// (every field of the export is listed; an unknown one answers 400 and nothing is written),
// membership (404 for non-members), `pool.import` (owner only, 403), the `imports` rate limit (20
// an hour per pool), then one `withPool` transaction (RLS): all or nothing. A commit is audited as
// `pool.prototype_imported` with the number of rows, never their content.

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/import-prototype',
  operationId: 'importPrototype',
  summary: 'Import the prototype’s JSON export',
  description:
    'Loads the file the prototype’s “Exportar cópia (JSON)” writes into an EMPTY pool (no accounts, movements, portfolios, assets, products, rules or own categories; people, month notes and settings may exist). Owner only; the body is at most 10 MB. `dryRun: true` returns the counts per entity and the warnings and writes nothing; `dryRun: false` writes everything in one transaction. Old ids become new UUID v7, movement hashes are recomputed with SHA-256, the prototype’s default categories map to the global catalogue and the rest become the pool’s own. Goals are read but not imported (no goals table yet). Answers 409 when the pool already has data, 400 for malformed JSON, unknown fields or values the schema cannot store.',
  tags: ['Pools'],
  request: {
    params: z.object({ poolId: z.uuid() }),
    body: { required: true, ...json(ImportPrototypeInput) },
  },
  responses: {
    200: { description: 'What the import created (or would create)', ...json(ImportResultDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});
