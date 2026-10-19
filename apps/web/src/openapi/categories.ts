import {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  UpdateCategoryInput,
  UpdateCategorySettingsInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Categories (ADR 0004): a global catalogue (25 defaults, named through i18n) every pool reads, plus
// categories a pool creates for itself. Guards in the service: session, input validation,
// membership (404 for non-members), `categories.write` (403) for writes, then `withPool` (RLS: a
// pool reads global rows and writes only its own). Writes are audited (`category.*`, target id).

const PoolId = z.uuid();
const CategoryId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/categories',
  operationId: 'listCategories',
  summary: 'Categories of the pool',
  description:
    'Any member may list. The global catalogue (`global: true`, `systemKey` set, no `name`: the name comes from i18n) plus the pool’s own categories, each with the pool’s `monthlyBudget` (EUR), `color` (own colour override first) and `hidden` flag.',
  tags: ['Categories'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The categories the pool sees', ...json(CategoryListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/categories',
  operationId: 'createCategory',
  summary: 'Create a category',
  description:
    'Needs `categories.write` (owner, admin). The category belongs to the pool of the URL and is invisible to every other pool; the name is unique in the pool (409). The body is strict: `poolId`, `id`, `systemKey` or any other field answers 400.',
  tags: ['Categories'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateCategoryInput) },
  },
  responses: {
    201: { description: 'The new category', ...json(CategoryDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/categories/{id}',
  operationId: 'updateCategory',
  summary: 'Change a category of the pool',
  description:
    'Needs `categories.write`. Only the pool’s own categories: a global one answers 403 (use the settings to budget, recolour or hide it). Fields left out stay.',
  tags: ['Categories'],
  request: {
    params: z.object({ poolId: PoolId, id: CategoryId }),
    body: { required: true, ...json(UpdateCategoryInput) },
  },
  responses: {
    200: { description: 'The updated category', ...json(CategoryDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/categories/{id}',
  operationId: 'deleteCategory',
  summary: 'Delete a category of the pool',
  description:
    'Needs `categories.write`. Only the pool’s own categories: a global one answers 403 (hide it instead). `replacement` is the category that receives its transactions and is required while any use it (400).',
  tags: ['Categories'],
  request: {
    params: z.object({ poolId: PoolId, id: CategoryId }),
    query: z.object({ replacement: z.uuid().optional() }),
  },
  responses: {
    204: { description: 'Category deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/categories/{id}/settings',
  operationId: 'updateCategorySettings',
  summary: 'Budget, colour and visibility of a category',
  description:
    'Needs `categories.write`. For any category the pool sees, global or its own: `monthlyBudget` (EUR, decimal string), `colorOverride` (`#rrggbb`) and `hidden`. They belong to this pool only. Fields left out stay; `null` clears a budget or colour. A category of another pool answers 404.',
  tags: ['Categories'],
  request: {
    params: z.object({ poolId: PoolId, id: CategoryId }),
    body: { required: true, ...json(UpdateCategorySettingsInput) },
  },
  responses: {
    200: { description: 'The category with its settings', ...json(CategoryDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});
