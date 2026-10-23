import { z } from 'zod';

import { CreateAssetInput } from '../assets/schemas';

import { importSpecSchema } from './parser-client';

// The DTOs and inputs of the statement import (NES-57). Inputs are `.strict()`: `poolId`, `status`,
// hashes, parser ids chosen by the server and the like are never accepted from the client.

/** Rows shown in a preview; the batch keeps every row for the commit. */
export const PREVIEW_ROWS_MAX = 2000;
/** Rows of the mapping preview (a csv nobody recognised). */
export const MAPPING_PREVIEW_ROWS = 20;
export const IMPORT_SYMBOLS_MAX = 200;

const Amount = z.string();
const Day = z.iso.date();

/** A parser that may read the file. */
export const ImportCandidateDto = z.object({
  parserId: z.string(),
  kind: z.enum(['bank', 'broker']),
  version: z.string(),
  /** 0..1 */
  confidence: z.number(),
});
export type ImportCandidateDto = z.infer<typeof ImportCandidateDto>;

export const PreviewBankRowDto = z.object({
  index: z.number().int(),
  kind: z.literal('bank'),
  date: Day,
  description: z.string(),
  amount: Amount,
  balance: Amount.nullable(),
  /** The account already has this line; `null` while no account is chosen. */
  duplicate: z.boolean().nullable(),
  /** The category the household's rules would give it. */
  categoryId: z.uuid().nullable(),
  transfer: z.boolean(),
  /** Would be paired with the other side of an internal transfer. */
  transferPair: z.boolean(),
  /** False when the line cannot be stored (an amount the ledger cannot hold) and is skipped. */
  valid: z.boolean(),
});

export const PreviewBrokerRowDto = z.object({
  index: z.number().int(),
  kind: z.literal('broker'),
  date: Day,
  type: z.string(),
  symbol: z.string().nullable(),
  quantity: Amount.nullable(),
  price: Amount.nullable(),
  amount: Amount,
  currency: z.string(),
  holder: z.string().nullable(),
  duplicate: z.boolean().nullable(),
  /** False for lines the import does not store yet (cash movements, interest, fees). */
  supported: z.boolean(),
});

export const PreviewRowDto = z.discriminatedUnion('kind', [PreviewBankRowDto, PreviewBrokerRowDto]);
export type PreviewRowDto = z.infer<typeof PreviewRowDto>;

export const BrokerPreviewDto = z.object({
  /** The broker's symbols and the asset of the pool each one matches (`null`: it must be created). */
  symbols: z.array(
    z.object({ symbol: z.string(), name: z.string().nullable(), assetId: z.uuid().nullable() }),
  ),
  /** The holders named in the file and the account's sub-account that carries their name. */
  holders: z.array(z.object({ holder: z.string(), subAccountId: z.uuid().nullable() })),
  /** The portfolio the account is linked to. */
  portfolioId: z.uuid().nullable(),
});

export const ImportPreviewDto = z.object({
  status: z.literal('preview'),
  batchId: z.uuid(),
  kind: z.enum(['bank', 'broker']),
  fileName: z.string(),
  parser: ImportCandidateDto,
  /** The parser and mapping remembered from the account's last import were used. */
  remembered: z.boolean(),
  accountId: z.uuid().nullable(),
  reconciled: z.boolean().nullable(),
  openingBalance: Amount.nullable(),
  closingBalance: Amount.nullable(),
  warnings: z.array(z.string()),
  /** The same file was imported before (SHA-256), when. */
  duplicateFile: z.object({ committedAt: z.iso.datetime() }).nullable(),
  summary: z.object({
    total: z.number().int(),
    new: z.number().int(),
    /** `null` while no account is chosen. */
    duplicates: z.number().int().nullable(),
    /** Lines that cannot be stored or are not supported yet. */
    skipped: z.number().int(),
  }),
  rows: z.array(PreviewRowDto).max(PREVIEW_ROWS_MAX),
  rowsTruncated: z.boolean(),
  broker: BrokerPreviewDto.nullable(),
});
export type ImportPreviewDto = z.infer<typeof ImportPreviewDto>;

export const ImportChooseParserDto = z.object({
  status: z.literal('choose-parser'),
  /** Several formats fit, or none fits well: the user picks and uploads again with `parserId`. */
  candidates: z.array(ImportCandidateDto),
});

export const ImportNeedsMappingDto = z.object({
  status: z.literal('needs-mapping'),
  /** The guessed mapping (an import spec): confirm or change a column, then upload again with `spec`. */
  spec: importSpecSchema,
  header: z.array(z.string()),
  preview: z.object({
    rowCount: z.number().int(),
    reconciled: z.boolean().nullable(),
    rows: z
      .array(
        z.object({
          date: Day,
          description: z.string(),
          amount: Amount,
          balance: Amount.nullable(),
        }),
      )
      .max(MAPPING_PREVIEW_ROWS),
  }),
});

/** What `POST /imports` answers. */
export const ImportStartDto = z.discriminatedUnion('status', [
  ImportPreviewDto,
  ImportChooseParserDto,
  ImportNeedsMappingDto,
]);
export type ImportStartDto = z.infer<typeof ImportStartDto>;

/**
 * The fields besides the file of the upload form. `accountId` is the account the lines are for
 * (it makes the duplicates known and picks the account's remembered parser), `parserId` the format
 * the user chose among the candidates, `spec` a column mapping the user confirmed.
 */
export const UploadFields = z
  .object({
    accountId: z.uuid().optional(),
    parserId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
      .optional(),
    spec: importSpecSchema.optional(),
  })
  .strict()
  .refine((fields) => !(fields.parserId && fields.spec), 'Give parserId or spec, not both.');
export type UploadFields = z.infer<typeof UploadFields>;

export const GetImportQuery = z.object({ accountId: z.uuid().optional() }).strict();

export const CommitImportInput = z
  .object({
    /** The account the lines are written to (a brokerage account for a broker file). */
    accountId: z.uuid(),
    /** Bank files: set the account's opening balance so its balance equals the statement's. */
    adjustOpeningBalance: z.boolean().default(false),
    /** Broker files: the portfolio of the operations (default: the account's own). */
    portfolioId: z.uuid().nullable().optional(),
    /** Broker symbol -> an asset of the pool, to use instead of the one matched by symbol. */
    assets: z.record(z.string().max(60), z.uuid()).default({}),
    /** Assets to create for symbols the pool does not have yet. */
    newAssets: z
      .array(CreateAssetInput.extend({ symbol: z.string().trim().min(1).max(30) }))
      .max(IMPORT_SYMBOLS_MAX)
      .default([]),
    /** Holder (first name) -> the account's sub-account; `null` leaves the lines without one. */
    subAccounts: z.record(z.string().max(60), z.uuid().nullable()).default({}),
  })
  .strict();
export type CommitImportInput = z.input<typeof CommitImportInput>;

export const CommitImportResultDto = z.object({
  batchId: z.uuid(),
  status: z.literal('committed'),
  accountId: z.uuid(),
  /** Lines written. */
  inserted: z.number().int(),
  /** Lines the account already had; left untouched. */
  duplicates: z.number().int(),
  /** Lines not written: cannot be stored, or are not supported yet. */
  skipped: z.number().int(),
  categorized: z.number().int(),
  transfersPaired: z.number().int(),
  assetsCreated: z.number().int(),
  openingBalanceAdjusted: z.boolean(),
});
export type CommitImportResultDto = z.infer<typeof CommitImportResultDto>;
