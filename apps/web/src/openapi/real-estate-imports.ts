import {
  RealEstateCommitResultDto,
  RealEstatePreviewDto,
  TEMPLATE_NAMES,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Real estate import (NES-102): the owner's mortgage workbook and the two CSV templates. Guards in
// the service, in this order: session, membership (404 for non-members), `imports.run` (403; the
// commit also needs `realestate.write`), the Pro plan (403 on Free), the `imports` rate limit (20
// uploads an hour per pool), strict upload fields (an unknown one answers 400), the file's content
// (415) and the isolated parser service, then `withPool` (RLS) and the audit entry
// (`import.realestate_committed`: the loan or property id and counts, never content). Nothing is
// written before the commit, and the commit is idempotent.

const poolParams = z.object({ poolId: z.uuid() });
const templateParams = z.object({ poolId: z.uuid(), name: z.enum(TEMPLATE_NAMES) });

const UploadForm = z.object({
  file: z.string().openapi({
    type: 'string',
    format: 'binary',
    description:
      'The mortgage workbook (.xlsx) or one of the CSV templates (.csv), at most 10 MB. Formulas are never evaluated: only cached values are read.',
  }),
  loanId: z.uuid().optional().openapi({
    description: 'The loan that receives installments and prepayments (the pool’s own).',
  }),
  propertyId: z.uuid().optional().openapi({
    description:
      'The property that receives works and acquisition costs; the loan’s own property when left out.',
  }),
  update: z.enum(['true', 'false']).optional().openapi({
    description:
      '`true` (the default) updates installments, works and phases that exist but differ from the file; `false` leaves every existing row alone.',
  }),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/real-estate-imports/preview',
  operationId: 'previewRealEstateImport',
  summary: 'Read a mortgage workbook or CSV template and preview it',
  description:
    'multipart/form-data with `file` and optional `loanId`, `propertyId`, `update`. Answers with the detected format and confidence, the rows per sheet, the totals, the two notices to give before importing (credit insurance outside the workbook totals, yearly inflation summed instead of compounded) and, when a loan or property is named, what importing would create, update or leave alone. Nothing is written.',
  tags: ['Imports'],
  request: {
    params: poolParams,
    body: { required: true, content: { 'multipart/form-data': { schema: UploadForm } } },
  },
  responses: {
    200: { description: 'The preview', ...json(RealEstatePreviewDto) },
    ...errorResponses(400, 401, 403, 404, 413, 415, 422, 429, 500, 502),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/real-estate-imports/commit',
  operationId: 'commitRealEstateImport',
  summary: 'Import a mortgage workbook or CSV template',
  description:
    'Same upload as the preview; reads the file again and writes it in one transaction. Installments are identified by loan and number, prepayments by loan, date and amount, works by property and name, payment phases by project, description, amount and planned date: importing the same file twice adds nothing. Existing rows change only with `update=true`, and only their figures: notes, descriptions, statuses of installments and links to bank movements are never touched. The installment fields the file has values for are switched on. Yearly inflation is read and shown but not stored.',
  tags: ['Imports'],
  request: {
    params: poolParams,
    body: { required: true, content: { 'multipart/form-data': { schema: UploadForm } } },
  },
  responses: {
    200: { description: 'What was written', ...json(RealEstateCommitResultDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/real-estate-imports/templates/{name}',
  operationId: 'downloadRealEstateTemplate',
  summary: 'Download a CSV template',
  description:
    'The `loan-installments` or `works-payments` template as a semicolon-separated CSV with a header and two example rows.',
  tags: ['Imports'],
  request: { params: templateParams },
  responses: {
    200: {
      description: 'The CSV file',
      content: { 'text/csv': { schema: z.string() } },
    },
    ...errorResponses(401, 403, 404, 500),
  },
});
