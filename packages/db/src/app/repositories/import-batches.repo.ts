import { and, desc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { importBatches, type ImportBatchRow } from '../schema/imports';

export type { ImportBatchRow };

export interface ImportBatchValues {
  kind: 'bank' | 'broker';
  fileName: string;
  fileSha256: string;
  sizeBytes: number;
  rowCount: number;
  parserId: string;
  parserKind: 'bank' | 'broker';
  parserVersion: string;
  /** 0..1, as a decimal string. */
  confidence: string;
  reconciled: boolean | null;
  accountId: string | null;
  /** The rows to show; cleared when the batch is settled. */
  preview: unknown;
  /** The column mapping in use, when the file was read with one. */
  spec: unknown;
}

/** One line of an account's import history. */
export interface BatchHistoryRow {
  id: string;
  accountId: string | null;
  fileName: string;
  rowCount: number;
  parserId: string;
  /** What the commit reported (`inserted`, `duplicates`, ...); `null` for older rows. */
  result: unknown;
  committedAt: Date;
}

export interface CommittedBatch {
  id: string;
  accountId: string | null;
  committedAt: Date | null;
}

/** What the next import of an account starts from: the parser and mapping of its last commit. */
export interface RememberedParser {
  parserId: string;
  parserKind: 'bank' | 'broker';
  parserVersion: string;
  spec: unknown;
}

/**
 * Uploaded statements. Every function filters by `ctx.poolId` (and RLS repeats it); ids and
 * hashes are bound parameters. A batch only moves forward: `preview` -> `committed` or
 * `discarded`, and the update checks the current status so two commits cannot both win.
 */
export const importBatchesRepo = {
  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    values: ImportBatchValues,
    createdBy: string,
  ): Promise<ImportBatchRow> {
    const [row] = await tx
      .insert(importBatches)
      .values({
        id,
        poolId: ctx.poolId,
        kind: values.kind,
        fileName: values.fileName,
        fileSha256: values.fileSha256,
        sizeBytes: values.sizeBytes,
        rowCount: values.rowCount,
        parserId: values.parserId,
        parserKind: values.parserKind,
        parserVersion: values.parserVersion,
        confidence: values.confidence,
        reconciled: values.reconciled,
        status: 'preview',
        accountId: values.accountId,
        preview: values.preview,
        spec: values.spec,
        createdBy,
      })
      .returning();
    if (!row) throw new Error('import_batches insert returned no row');
    return row;
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<ImportBatchRow | undefined> {
    const [row] = await tx
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.poolId, ctx.poolId), eq(importBatches.id, id)))
      .limit(1);
    return row;
  },

  /** The latest committed batch of a file (same SHA-256), to warn about importing it twice. */
  async findCommittedByHash(
    tx: PoolTx,
    ctx: PoolContext,
    sha256: string,
  ): Promise<CommittedBatch | undefined> {
    const [row] = await tx
      .select({
        id: importBatches.id,
        accountId: importBatches.accountId,
        committedAt: importBatches.committedAt,
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.poolId, ctx.poolId),
          eq(importBatches.fileSha256, sha256),
          eq(importBatches.status, 'committed'),
        ),
      )
      .orderBy(desc(importBatches.committedAt))
      .limit(1);
    return row;
  },

  /** The parser and mapping of the account's last committed import. */
  async lastForAccount(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
  ): Promise<RememberedParser | undefined> {
    const [row] = await tx
      .select({
        parserId: importBatches.parserId,
        parserKind: importBatches.parserKind,
        parserVersion: importBatches.parserVersion,
        spec: importBatches.spec,
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.poolId, ctx.poolId),
          eq(importBatches.accountId, accountId),
          eq(importBatches.status, 'committed'),
        ),
      )
      .orderBy(desc(importBatches.committedAt))
      .limit(1);
    return row as RememberedParser | undefined;
  },

  /** The latest committed batches of the pool, newest first; of one account when `accountId` is given. */
  async listCommitted(
    tx: PoolTx,
    ctx: PoolContext,
    options: { accountId?: string | undefined; limit: number },
  ): Promise<BatchHistoryRow[]> {
    const rows = await tx
      .select({
        id: importBatches.id,
        accountId: importBatches.accountId,
        fileName: importBatches.fileName,
        rowCount: importBatches.rowCount,
        parserId: importBatches.parserId,
        result: importBatches.result,
        committedAt: importBatches.committedAt,
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.poolId, ctx.poolId),
          eq(importBatches.status, 'committed'),
          options.accountId ? eq(importBatches.accountId, options.accountId) : undefined,
        ),
      )
      .orderBy(desc(importBatches.committedAt), desc(importBatches.id))
      .limit(options.limit);
    return rows.flatMap((row) =>
      row.committedAt ? [{ ...row, committedAt: row.committedAt }] : [],
    );
  },

  /**
   * `preview` -> `committed`. Returns `undefined` when the batch is not in the pool or is no
   * longer a preview. The stored rows are dropped: the ledger has them now.
   */
  async markCommitted(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    settle: { accountId: string; spec: unknown; result: unknown; at: Date },
  ): Promise<ImportBatchRow | undefined> {
    const [row] = await tx
      .update(importBatches)
      .set({
        status: 'committed',
        accountId: settle.accountId,
        spec: settle.spec,
        result: settle.result,
        preview: null,
        committedAt: settle.at,
        updatedAt: settle.at,
      })
      .where(
        and(
          eq(importBatches.poolId, ctx.poolId),
          eq(importBatches.id, id),
          eq(importBatches.status, 'preview'),
        ),
      )
      .returning();
    return row;
  },

  /** `preview` -> `discarded`, dropping the stored rows. */
  async markDiscarded(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    at: Date,
  ): Promise<ImportBatchRow | undefined> {
    const [row] = await tx
      .update(importBatches)
      .set({ status: 'discarded', preview: null, updatedAt: at })
      .where(
        and(
          eq(importBatches.poolId, ctx.poolId),
          eq(importBatches.id, id),
          eq(importBatches.status, 'preview'),
        ),
      )
      .returning();
    return row;
  },
};
