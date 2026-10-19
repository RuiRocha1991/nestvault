import {
  AssetDto,
  AssetListDto,
  BulkPricesDto,
  BulkPricesInput,
  CreateAssetInput,
  PriceDto,
  PriceHistoryDto,
  PriceInput,
  UpdateAssetInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Assets (PRD 04): each instrument is defined once and priced once for every account and portfolio
// that holds it. Guards in the service: session, input validation, membership (404 for
// non-members), `portfolios.write` (assets) or `prices.write` (prices, members too) for writes (403),
// then `withPool` (RLS). Writes are audited (`asset.*`, target id only).

const PoolId = z.uuid();
const AssetId = z.uuid();
const AsOf = z.object({ asOf: z.iso.date().optional() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/assets',
  operationId: 'listAssets',
  summary: 'Assets of the pool',
  description:
    'Any member may list. `price` is the newest price dated on or before `asOf` (today by default) and `priceDate` its day; both are null while the asset has no price.',
  tags: ['Assets'],
  request: { params: z.object({ poolId: PoolId }), query: AsOf },
  responses: {
    200: { description: 'The assets of the pool', ...json(AssetListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/assets',
  operationId: 'createAsset',
  summary: 'Define an asset',
  description:
    'Needs `portfolios.write` (owner, admin). The ticker is stored upper case and is unique inside the pool (409). `dps` is the annual dividend per share, `divMonths` the months (1–12) it is paid in. The body is strict: `poolId`, `id` or any other field answers 400.',
  tags: ['Assets'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateAssetInput) },
  },
  responses: {
    201: { description: 'The new asset', ...json(AssetDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/assets/{id}',
  operationId: 'getAsset',
  summary: 'One asset',
  description: 'Any member may read. An asset of another pool answers 404.',
  tags: ['Assets'],
  request: { params: z.object({ poolId: PoolId, id: AssetId }), query: AsOf },
  responses: {
    200: { description: 'The asset', ...json(AssetDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/assets/{id}',
  operationId: 'updateAsset',
  summary: 'Change an asset',
  description: 'Needs `portfolios.write`. Fields left out stay. 409 for a ticker already in use.',
  tags: ['Assets'],
  request: {
    params: z.object({ poolId: PoolId, id: AssetId }),
    body: { required: true, ...json(UpdateAssetInput) },
  },
  responses: {
    200: { description: 'The updated asset', ...json(AssetDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/assets/{id}',
  operationId: 'deleteAsset',
  summary: 'Delete an asset',
  description:
    'Needs `portfolios.write`. Its price history goes with it. Answers 409 while operations use the asset.',
  tags: ['Assets'],
  request: { params: z.object({ poolId: PoolId, id: AssetId }) },
  responses: {
    204: { description: 'Asset deleted' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/assets/{id}/prices',
  operationId: 'listAssetPrices',
  summary: 'Price history of an asset',
  description:
    'Any member may read. Newest first; `from`/`to` bound the days, `limit` defaults to 1000.',
  tags: ['Assets'],
  request: {
    params: z.object({ poolId: PoolId, id: AssetId }),
    query: z.object({
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    }),
  },
  responses: {
    200: { description: 'The price history', ...json(PriceHistoryDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/assets/{id}/prices',
  operationId: 'setAssetPrice',
  summary: 'Set the price of a day',
  description:
    'Needs `prices.write` (owner, admin and member; a viewer gets 403). Adds the price of the day or replaces it, so every account and portfolio holding the asset sees the new value. A future date answers 400.',
  tags: ['Assets'],
  request: {
    params: z.object({ poolId: PoolId, id: AssetId }),
    body: { required: true, ...json(PriceInput) },
  },
  responses: {
    200: { description: 'The stored price', ...json(PriceDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/assets/{id}/prices/{date}',
  operationId: 'deleteAssetPrice',
  summary: 'Remove the price of a day',
  description: 'Needs `prices.write`.',
  tags: ['Assets'],
  request: { params: z.object({ poolId: PoolId, id: AssetId, date: z.iso.date() }) },
  responses: {
    204: { description: 'Price removed' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/asset-prices',
  operationId: 'bulkAssetPrices',
  summary: 'Update many prices at once',
  description:
    'Needs `prices.write`. Prices are given by ticker (1–500 entries) and written in one transaction: an unknown ticker, a future date or any other invalid entry rejects the whole batch (400) and nothing is stored. Two entries for the same asset and day: the last one wins.',
  tags: ['Assets'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(BulkPricesInput) },
  },
  responses: {
    200: { description: 'How many prices were stored', ...json(BulkPricesDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});
