import {
  ListMonthsQuery,
  MonthNoteDto,
  MonthNoteListDto,
  NoteDto,
  PutMonthNoteInput,
  SetNoteInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Notes on movements and operations, and month notes (NES-45). Guards in the service: session,
// input validation, membership (404 for non-members), `notes.write` for writes (403: viewers),
// then `withPool` (RLS). Writes are audited as `note.updated` with the row id only; the text is
// never logged or audited.

const pool = z.object({ poolId: z.uuid() });
const item = z.object({ poolId: z.uuid(), id: z.uuid() });
const month = z.object({
  poolId: z.uuid(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .openapi({ example: '2026-03' }),
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/transactions/{id}/note',
  operationId: 'setTransactionNote',
  summary: 'Set or clear the note of a movement',
  description:
    'Needs `notes.write`. At most 2 000 characters (400 beyond). `null` or an empty text clears the note. Imports never touch notes.',
  tags: ['Notes'],
  request: { params: item, body: { required: true, ...json(SetNoteInput) } },
  responses: {
    200: { description: 'The note and who last wrote it', ...json(NoteDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/ops/{id}/note',
  operationId: 'setOperationNote',
  summary: 'Set or clear the note of an investment operation',
  description: 'Same rules as the note of a movement.',
  tags: ['Notes'],
  request: { params: item, body: { required: true, ...json(SetNoteInput) } },
  responses: {
    200: { description: 'The note and who last wrote it', ...json(NoteDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/months/{month}/note',
  operationId: 'getMonthNote',
  summary: 'The note of a month',
  description:
    'Any member may read. A month without a note answers 200 with `body` and `updatedAt` null. `month` is `yyyy-mm` (`2026-13` answers 400).',
  tags: ['Notes'],
  request: { params: month },
  responses: {
    200: { description: 'The month note', ...json(MonthNoteDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/pools/{poolId}/months/{month}/note',
  operationId: 'putMonthNote',
  summary: 'Write the note of a month',
  description:
    'Needs `notes.write`. At most 10 000 characters (400 beyond); an empty `body` clears the note. Optimistic locking: send the `updatedAt` of the version you loaded as `expectedUpdatedAt` (`null` if the month had no note). If somebody saved first the answer is 409 and `error.current` holds the version that won.',
  tags: ['Notes'],
  request: { params: month, body: { required: true, ...json(PutMonthNoteInput) } },
  responses: {
    200: { description: 'The saved note', ...json(MonthNoteDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/months',
  operationId: 'listMonthNotes',
  summary: 'Month notes of a range, for the timeline',
  description:
    'Any member may read. `from` and `to` are `yyyy-mm`, `from` not after `to`, at most 120 months. Only months that have a note are returned, oldest first.',
  tags: ['Notes'],
  request: { params: pool, query: ListMonthsQuery },
  responses: {
    200: { description: 'The notes', ...json(MonthNoteListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});
