import {
  CommitImportInput,
  CommitImportResultDto,
  GetImportQuery,
  ImportHistoryDto,
  ImportHistoryQuery,
  ImportPreviewDto,
  ImportStartDto,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Statement import (NES-57). Guards in the service, in this order: session, strict input (the
// upload fields and the commit body list every accepted field; an unknown one answers 400),
// membership (404 for non-members, also for a batch of another pool), `imports.run` (403), the
// `imports` rate limit (20 uploads an hour per pool), then `withPool` (RLS) and the audit entry
// (`import.uploaded` / `import.committed` / `import.discarded`: ids and counts, never content).
// The file is checked by its content (415), kept encrypted (AES-256-GCM, named by its SHA-256) and
// read by the isolated parser service. Nothing reaches the ledger before the commit.

const poolParams = z.object({ poolId: z.uuid() });
const batchParams = z.object({ poolId: z.uuid(), batchId: z.uuid() });

const UploadForm = z.object({
  file: z.string().openapi({
    type: 'string',
    format: 'binary',
    description: 'The statement: .xlsx, .xlsm, .pdf or .csv, at most 10 MB.',
  }),
  accountId: z.uuid().optional().openapi({
    description:
      'The account the lines are for. It makes the duplicates known and selects the parser and column mapping the account used last.',
  }),
  parserId: z.string().optional().openapi({
    description: 'A format the user chose among the candidates of an earlier answer.',
  }),
  spec: z.string().optional().openapi({
    description:
      'JSON text of a column mapping (an import spec) the user confirmed, as proposed by an earlier answer.',
  }),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/imports',
  operationId: 'startImport',
  summary: 'Upload a statement and preview it',
  description:
    'multipart/form-data with `file` and optional `accountId`, `parserId`, `spec`. The answer depends on `status`: `preview` (201) has the batch and its lines, each marked as a duplicate or new with the category the pool’s rules would give and the internal transfers it would complete; `choose-parser` (200) lists the formats that fit when several do or only a weak one does, upload again with `parserId`; `needs-mapping` (200) is for a csv no format recognises: a guessed column mapping to confirm, upload again with `spec`. A file that was already imported (same SHA-256) is reported in `duplicateFile`. Nothing is written to the ledger.',
  tags: ['Imports'],
  request: {
    params: poolParams,
    body: { required: true, content: { 'multipart/form-data': { schema: UploadForm } } },
  },
  responses: {
    201: { description: 'A preview, ready to commit', ...json(ImportPreviewDto) },
    200: {
      description: 'A choice of formats, or a column mapping to confirm',
      ...json(ImportStartDto),
    },
    ...errorResponses(400, 401, 403, 404, 413, 415, 422, 429, 500, 502),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/imports',
  operationId: 'listImports',
  summary: 'The history of committed imports',
  description:
    'The last 50 committed imports of the pool, newest first; `?accountId=` narrows it to one account. Needs `imports.run`.',
  tags: ['Imports'],
  request: { params: poolParams, query: ImportHistoryQuery },
  responses: {
    200: { description: 'The history', ...json(ImportHistoryDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/imports/{batchId}',
  operationId: 'getImport',
  summary: 'The preview of a pending import',
  description:
    'The same preview again; `?accountId=` shows it for another account. 409 once the batch is committed or discarded.',
  tags: ['Imports'],
  request: { params: batchParams, query: GetImportQuery },
  responses: {
    200: { description: 'The preview', ...json(ImportPreviewDto) },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/imports/{batchId}/commit',
  operationId: 'commitImport',
  summary: 'Commit a pending import',
  description:
    'Writes the batch into `accountId` in one transaction. Lines the account already has (same hash, or same broker id) are left alone, so importing the same file twice adds nothing; two identical lines inside one file are both kept. Notes and categories chosen by hand are never touched. New lines get the category the pool’s rules give and the transfers they complete are paired. `adjustOpeningBalance` sets the account’s opening balance so that its balance equals the statement’s closing balance. Broker files also need a portfolio and an asset for every symbol (`assets`, or `newAssets` to create them); dividends, the tax withheld and its refund become one operation. A batch of another pool answers 404, one already settled 409.',
  tags: ['Imports'],
  request: { params: batchParams, body: { required: true, ...json(CommitImportInput) } },
  responses: {
    200: { description: 'What was written', ...json(CommitImportResultDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/imports/{batchId}',
  operationId: 'discardImport',
  summary: 'Discard a pending import',
  description: 'Drops the stored rows of a pending batch. 409 once it is committed or discarded.',
  tags: ['Imports'],
  request: { params: batchParams },
  responses: {
    204: { description: 'Discarded' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});
