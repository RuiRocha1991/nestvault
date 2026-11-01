import { z } from 'zod';

// The inputs and DTOs of the real estate import (NES-102). The upload fields are `.strict()`: the
// pool, the parser and the status are never accepted from the client; the loan and the property
// are ids that are checked against the pool.

export const UploadFields = z
  .object({
    /** The loan that receives installments and prepayments. */
    loanId: z.uuid().optional(),
    /** The property that receives works and acquisition costs; the loan's own when left out. */
    propertyId: z.uuid().optional(),
    /** "Update existing installments without duplicating" (the dialog's checkbox, on by default). */
    update: z.enum(['true', 'false']).default('true'),
  })
  .strict();
export type UploadFields = z.infer<typeof UploadFields>;

const Amount = z.string();

export const SheetSummaryDto = z.object({
  sheet: z.string(),
  label: z.string(),
  rows: z.number().int(),
  action: z.enum(['import', 'recalculated']),
});

export const PlanCountsDto = z.object({
  installments: z.object({
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
  }),
  prepayments: z.object({ create: z.number().int(), unchanged: z.number().int() }),
  works: z.object({
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
  }),
  payments: z.object({
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    kept: z.number().int(),
  }),
  costs: z.enum(['none', 'fill', 'update', 'unchanged']),
  /** Installment fields the import switches on because the file has values for them. */
  fieldsEnabled: z.array(z.string()),
  /** CPI rows read from the file (shown, not stored). */
  inflation: z.number().int(),
});
export type PlanCountsDto = z.infer<typeof PlanCountsDto>;

export const AcquisitionCostsDto = z.object({
  deed: Amount,
  imt: Amount,
  stampDuty: Amount,
  registration: Amount,
  bankFees: Amount,
  total: Amount,
});

export const RealEstatePreviewDto = z.object({
  fileName: z.string(),
  parserId: z.string(),
  parserVersion: z.string(),
  /** 0..1 */
  confidence: z.number(),
  rowCount: z.number().int(),
  sheets: z.array(SheetSummaryDto),
  totals: z.object({
    installments: z.number().int(),
    capital: Amount,
    interest: Amount,
    prepayments: Amount,
    works: Amount,
    payments: Amount,
    creditInsurance: Amount,
  }),
  costs: AcquisitionCostsDto.nullable(),
  /** The installment fields the file has values for. */
  fieldsWithValues: z.array(z.string()),
  inflation: z
    .object({
      rows: z.array(z.object({ year: z.number().int(), ratePct: Amount })),
      compoundedPct: Amount,
      summedPct: Amount,
    })
    .nullable(),
  /** The two things to tell before importing (workbook totals vs the app's). */
  notices: z.object({
    creditInsurance: Amount.nullable(),
    inflationSummed: z.boolean(),
  }),
  warnings: z.array(z.string()),
  /** What importing into the chosen loan and property would do; `null` before they are chosen. */
  plan: PlanCountsDto.nullable(),
  /** The file has rows that need a loan / a property the request did not name. */
  needs: z.object({ loan: z.boolean(), property: z.boolean() }),
});
export type RealEstatePreviewDto = z.infer<typeof RealEstatePreviewDto>;

export const RealEstateCommitResultDto = z.object({
  fileName: z.string(),
  parserId: z.string(),
  loanId: z.uuid().nullable(),
  propertyId: z.uuid().nullable(),
  result: PlanCountsDto,
});
export type RealEstateCommitResultDto = z.infer<typeof RealEstateCommitResultDto>;

export const TEMPLATE_NAMES = ['loan-installments', 'works-payments'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
