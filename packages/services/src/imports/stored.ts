import { z } from 'zod';

import { importSpecSchema } from './parser-client';
import { parserResponseSchema } from './parser-rows.generated';

/**
 * What a `preview` batch keeps in `import_batches.preview`: the parser's answer exactly as it was
 * validated, so the commit writes what the user saw. Validated again on every read (the column is
 * `jsonb`: whatever a bug or a manual edit put there must not reach the ledger unchecked).
 */
export const StoredPreview = z
  .object({
    response: parserResponseSchema,
    remembered: z.boolean(),
  })
  .strict();
export type StoredPreview = z.infer<typeof StoredPreview>;

/** The mapping stored on a batch (`import_batches.spec`). */
export const StoredSpec = importSpecSchema.nullable();
