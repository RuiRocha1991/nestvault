import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  boolean,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { poolId } from '../../columns';

import { accounts } from './accounts';

// One uploaded statement (NES-57). A batch is created in `preview` (nothing is written to the
// ledger), becomes `committed` when the user confirms and `discarded` when they do not. The file
// itself is stored encrypted outside the database under its `file_sha256`; `preview` holds the rows
// to show and is cleared once the batch is settled. `parser_*` and `confidence` say how the file
// was recognised, `spec` is the column mapping the user confirmed (the account's next import reuses
// the last committed one). `created_by` is a user id of the identity database (ids only).
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    rowCount: integer('row_count').notNull(),
    parserId: text('parser_id').notNull(),
    parserKind: text('parser_kind').notNull(),
    parserVersion: text('parser_version').notNull(),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull(),
    reconciled: boolean('reconciled'),
    status: text('status').notNull().default('preview'),
    accountId: uuid('account_id'),
    preview: jsonb('preview'),
    spec: jsonb('spec'),
    result: jsonb('result'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('import_batches_pool_id_uniq').on(table.poolId, table.id),
    index('import_batches_pool_status_idx').on(table.poolId, table.status, table.createdAt.desc()),
    index('import_batches_pool_sha_idx').on(table.poolId, table.fileSha256),
    index('import_batches_pool_account_idx').on(
      table.poolId,
      table.accountId,
      table.committedAt.desc(),
    ),
    check('import_batches_kind', sql`${table.kind} in ('bank', 'broker')`),
    check('import_batches_parser_kind', sql`${table.parserKind} in ('bank', 'broker')`),
    check('import_batches_status', sql`${table.status} in ('preview', 'committed', 'discarded')`),
    check('import_batches_sha256', sql`${table.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check('import_batches_file_name_len', sql`char_length(${table.fileName}) between 1 and 255`),
    check('import_batches_size', sql`${table.sizeBytes} between 1 and 10485760`),
    check('import_batches_rows', sql`${table.rowCount} >= 0`),
    check('import_batches_confidence', sql`${table.confidence} between 0 and 1`),
    // The account may be deleted once its movements are gone; the batch stays as history.
    foreignKey({
      name: 'import_batches_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('set null'),
  ],
);

export type ImportBatchRow = typeof importBatches.$inferSelect;
