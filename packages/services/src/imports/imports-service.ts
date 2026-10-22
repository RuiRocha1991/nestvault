import { createHash } from 'node:crypto';

import {
  accountsRepo,
  importBatchesRepo,
  isUuid,
  newId,
  withPool,
  type AccountRow,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UpstreamError,
  ValidationError,
} from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { IMPORT_MAX_BYTES } from '../prototype-import/schema';
import { clientIpResolver, type RateLimiter } from '../rate-limit';
import { zodProblem } from '../zod-problem';

import { commitBank, commitBroker, parsedInput } from './commit';
import { detectAndParse } from './detect';
import { cleanFileName, sniffUpload } from './file-type';
import type { ParserClient } from './parser-client';
import { buildPreview } from './preview-dto';
import {
  CommitImportInput,
  CommitImportResultDto,
  GetImportQuery,
  ImportStartDto,
  MAPPING_PREVIEW_ROWS,
  UploadFields,
  type ImportPreviewDto,
} from './schemas';
import type { FileStore } from './storage';
import { StoredPreview } from './stored';

export interface UploadInput {
  /** The name the client gave the file; cleaned before it is stored or shown. */
  fileName: string;
  bytes: Uint8Array;
  /** The other fields of the form, unchecked. */
  fields: unknown;
}

export interface ImportsService {
  /**
   * Reads a statement and answers with a preview, a choice of formats or a column mapping to
   * confirm. Nothing is written to the ledger (`imports.run`; 20 uploads an hour per pool). `read`
   * is called only after the caller is known to be allowed, so a stranger's body is never read.
   */
  start(
    headers: Headers,
    poolId: string,
    read: () => Promise<UploadInput>,
  ): Promise<ImportStartDto>;
  /** The preview of a pending batch again, optionally for another account (`imports.run`). */
  get(
    headers: Headers,
    poolId: string,
    batchId: string,
    query?: unknown,
  ): Promise<ImportPreviewDto>;
  /** Writes the batch into the account in one transaction; lines already there are left alone. */
  commit(
    headers: Headers,
    poolId: string,
    batchId: string,
    input: unknown,
  ): Promise<CommitImportResultDto>;
  /** Drops a pending batch (`imports.run`). */
  discard(headers: Headers, poolId: string, batchId: string): Promise<void>;
}

export interface CommittedImport {
  accountId: string;
  kind: 'bank' | 'broker';
  inserted: number;
}

export interface ImportsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  limiter: RateLimiter;
  parser: ParserClient;
  files: FileStore;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
  /** Called after a commit; the deposit-interest linking job (`deposits.link`) plugs in here. */
  afterCommit?: (ctx: PoolContext, committed: CommittedImport) => Promise<void>;
}

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

export function createImportsService(deps: ImportsServiceDeps): ImportsService {
  const { auth, identity, limiter, parser, files } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const afterCommit = deps.afterCommit ?? (() => Promise.resolve());

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** A bank file goes to a cash account, a broker file to a brokerage account. */
  function assertFits(account: AccountRow, kind: 'bank' | 'broker') {
    const brokerage = account.type === 'brokerage';
    if (brokerage !== (kind === 'broker')) {
      throw invalid(
        'accountId',
        kind === 'broker'
          ? 'a broker file needs a brokerage account'
          : 'a statement needs a bank, savings or deposit account',
      );
    }
  }

  async function findAccount(tx: PoolTx, ctx: PoolContext, id: string): Promise<AccountRow> {
    const account = await accountsRepo.find(tx, ctx, id.toLowerCase());
    if (!account) throw invalid('accountId', 'not an account of this pool');
    return account;
  }

  return {
    async start(headers, poolId, read) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'imports.run');
      await limiter.consume('imports', ctx.poolId);

      const upload = await read();
      if (upload.bytes.length > IMPORT_MAX_BYTES) throw new PayloadTooLargeError();
      const fields = UploadFields.safeParse(upload.fields);
      if (!fields.success) throw zodProblem(fields.error, upload.fields);
      const fileName = cleanFileName(upload.fileName);
      const fileKind = sniffUpload(upload.bytes, fileName);
      const sha256 = createHash('sha256').update(upload.bytes).digest('hex');

      const remembered = fields.data.accountId
        ? await run(ctx, async (tx) => {
            const account = await findAccount(tx, ctx, fields.data.accountId ?? '');
            return { account, last: await importBatchesRepo.lastForAccount(tx, ctx, account.id) };
          })
        : null;

      const outcome = await detectAndParse(parser, {
        bytes: upload.bytes,
        kind: fileKind,
        parserId: fields.data.parserId,
        spec: fields.data.spec,
        remembered: remembered?.last,
      });

      if (outcome.outcome === 'choose-parser') {
        return ImportStartDto.parse({
          status: 'choose-parser',
          candidates: outcome.candidates.map((c) => ({
            parserId: c.parser_id,
            kind: c.kind,
            version: c.version,
            confidence: c.confidence,
          })),
        });
      }
      if (outcome.outcome === 'needs-mapping') {
        const { proposal } = outcome;
        return ImportStartDto.parse({
          status: 'needs-mapping',
          spec: proposal.spec,
          header: proposal.header,
          preview: {
            rowCount: proposal.preview.meta.row_count,
            reconciled: proposal.preview.meta.reconciled,
            rows: proposal.preview.rows
              .flatMap((row) => (row.kind === 'bank' ? [row] : []))
              .slice(0, MAPPING_PREVIEW_ROWS)
              .map((row) => ({
                date: row.date,
                description: row.description,
                amount: row.amount,
                balance: row.balance,
              })),
          },
        });
      }

      const { response } = outcome;
      const kinds = new Set(response.rows.map((row) => row.kind));
      const [kind] = kinds;
      if (kinds.size !== 1 || kind === undefined) throw new UpstreamError();
      if (remembered) assertFits(remembered.account, kind);

      await files.put(ctx.poolId, sha256, upload.bytes);
      const batchId = newId();
      const stored = StoredPreview.parse({ response, remembered: outcome.remembered });
      const dto = await run(ctx, async (tx) => {
        const duplicateFile = await importBatchesRepo.findCommittedByHash(tx, ctx, sha256);
        const batch = await importBatchesRepo.insert(
          tx,
          ctx,
          batchId,
          {
            kind,
            fileName,
            fileSha256: sha256,
            sizeBytes: upload.bytes.length,
            rowCount: response.rows.length,
            parserId: response.meta.parser_id,
            parserKind: kind,
            parserVersion: response.meta.parser_version,
            confidence: outcome.parser.confidence.toFixed(4),
            reconciled: response.meta.reconciled,
            accountId: remembered?.account.id ?? null,
            preview: stored,
            spec: outcome.spec,
          },
          session.userId,
        );
        return buildPreview(tx, ctx, {
          stored,
          batch,
          accountId: batch.accountId,
          duplicateFileAt: duplicateFile?.committedAt ?? null,
        });
      });
      await recordAudit(identity, ctx, 'import.uploaded', {
        target: batchId,
        meta: { count: response.rows.length },
        ip: ipOf(headers),
      });
      return ImportStartDto.parse(dto);
    },

    async get(headers, poolId, batchId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = GetImportQuery.safeParse(query);
      if (!parsed.success) throw zodProblem(parsed.error, query);
      const id = parseId(batchId);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'imports.run');
      return run(ctx, async (tx) => {
        const batch = await importBatchesRepo.find(tx, ctx, id);
        if (!batch) throw new NotFoundError();
        if (batch.status !== 'preview') throw new ConflictError('This import is already settled.');
        const accountId = parsed.data.accountId ?? batch.accountId;
        if (accountId)
          assertFits(
            await findAccount(tx, ctx, accountId),
            batch.kind === 'broker' ? 'broker' : 'bank',
          );
        const duplicateFile = await importBatchesRepo.findCommittedByHash(
          tx,
          ctx,
          batch.fileSha256,
        );
        return buildPreview(tx, ctx, {
          stored: StoredPreview.parse(batch.preview),
          batch,
          accountId: accountId?.toLowerCase() ?? null,
          duplicateFileAt: duplicateFile?.committedAt ?? null,
        });
      });
    },

    async commit(headers, poolId, batchId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CommitImportInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const id = parseId(batchId);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'imports.run');
      const data = parsedInput(parsed.data);

      const result = await run(ctx, async (tx) => {
        const batch = await importBatchesRepo.find(tx, ctx, id);
        if (!batch) throw new NotFoundError();
        if (batch.status !== 'preview') throw new ConflictError('This import is already settled.');
        const kind: 'bank' | 'broker' = batch.kind === 'broker' ? 'broker' : 'bank';
        const account = await findAccount(tx, ctx, data.accountId);
        assertFits(account, kind);
        const stored = StoredPreview.parse(batch.preview);
        const args = { tx, ctx, batch, stored, account, input: data };
        const outcome = kind === 'bank' ? await commitBank(args) : await commitBroker(args);
        const settled = await importBatchesRepo.markCommitted(tx, ctx, id, {
          accountId: account.id,
          spec: batch.spec,
          result: outcome,
          at: now(),
        });
        // A second commit of the same batch got here first: undo this one's writes too.
        if (!settled) throw new ConflictError('This import is already settled.');
        return { outcome, kind, accountId: account.id };
      });

      await recordAudit(identity, ctx, 'import.committed', {
        target: id,
        meta: { count: result.outcome.inserted },
        ip: ipOf(headers),
      });
      await afterCommit(ctx, {
        accountId: result.accountId,
        kind: result.kind,
        inserted: result.outcome.inserted,
      });
      return CommitImportResultDto.parse({
        batchId: id,
        status: 'committed',
        accountId: result.accountId,
        ...result.outcome,
      });
    },

    async discard(headers, poolId, batchId) {
      const session = await requireSession(auth, headers);
      const id = parseId(batchId);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'imports.run');
      await run(ctx, async (tx) => {
        if (await importBatchesRepo.markDiscarded(tx, ctx, id, now())) return;
        if (await importBatchesRepo.find(tx, ctx, id)) {
          throw new ConflictError('This import is already settled.');
        }
        throw new NotFoundError();
      });
      await recordAudit(identity, ctx, 'import.discarded', { target: id, ip: ipOf(headers) });
    },
  };
}
