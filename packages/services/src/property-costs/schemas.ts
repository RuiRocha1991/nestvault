import { COST_PERIODICITIES, PROPERTY_COST_KINDS, type PropertyCostRow } from '@nestvault/db';
import { annualAmount, dec, type CostOccurrence, type CostTotals } from '@nestvault/domain';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;

const Name = z.string().trim().min(1).max(80).regex(NO_CONTROL);

/** A decimal string with up to 4 decimals (numeric(18,4)); never a JS float. */
const PositiveAmount = z
  .string()
  .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value) && dec(value).gt(0));

export const CostKind = z.enum(PROPERTY_COST_KINDS);
export const CostPeriodicity = z.enum(COST_PERIODICITIES);

/** The months between two occurrences of a custom periodicity. */
const Interval = z.number().int().min(1).max(60);

/**
 * Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). `intervalMonths`
 * is only for a custom periodicity; the service rejects it otherwise and requires it for custom.
 */
export const CreateCostInput = z
  .object({
    propertyId: z.uuid(),
    kind: CostKind,
    name: Name.nullable().optional(),
    amount: PositiveAmount,
    periodicity: CostPeriodicity,
    intervalMonths: Interval.optional(),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable().optional(),
    accountId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateCostInput = z.infer<typeof CreateCostInput>;

/** The property of a cost does not change: move it by creating the cost again. */
export const UpdateCostInput = CreateCostInput.omit({ propertyId: true }).partial().strict();
export type UpdateCostInput = z.infer<typeof UpdateCostInput>;

export const LinkCostPaymentInput = z.object({ transactionId: z.uuid() }).strict();
export type LinkCostPaymentInput = z.infer<typeof LinkCostPaymentInput>;

/** The due date in the URL of a payment. */
export const DueDate = z.iso.date();

export const UpcomingCostsQuery = z
  .object({ months: z.coerce.number().int().min(1).max(24).default(12) })
  .strict();
export type UpcomingCostsQuery = z.infer<typeof UpcomingCostsQuery>;

export const CostTotalsQuery = z
  .object({
    propertyId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();
export type CostTotalsQuery = z.infer<typeof CostTotalsQuery>;

const Money = z.string();

export const CostDto = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  kind: CostKind,
  name: z.string().nullable(),
  amount: Money,
  periodicity: CostPeriodicity,
  intervalMonths: z.number().int(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  accountId: z.uuid().nullable(),
  /** What the cost adds up to in a year. */
  annualAmount: Money,
  /** The first due date from today on; `null` once the cost has ended. */
  nextDueDate: z.string().nullable(),
});
export type CostDto = z.infer<typeof CostDto>;

export const CostListDto = z.object({ costs: z.array(CostDto) });
export type CostListDto = z.infer<typeof CostListDto>;

export const OccurrenceDto = z.object({
  costId: z.uuid(),
  propertyId: z.uuid(),
  kind: CostKind,
  name: z.string().nullable(),
  dueDate: z.string(),
  amount: Money,
  /** `covered`: the same insurance is already inside a loan installment of that month. */
  status: z.enum(['expected', 'paid', 'covered']),
  transactionId: z.uuid().nullable(),
});
export type OccurrenceDto = z.infer<typeof OccurrenceDto>;

export const CostPaymentDto = z.object({
  costId: z.uuid(),
  dueDate: z.string(),
  transactionId: z.uuid(),
});
export type CostPaymentDto = z.infer<typeof CostPaymentDto>;

export const CostMonthDto = z.object({
  month: z.string(),
  amount: Money,
  occurrences: z.array(OccurrenceDto),
});

export const UpcomingCostsDto = z.object({ months: z.array(CostMonthDto) });
export type UpcomingCostsDto = z.infer<typeof UpcomingCostsDto>;

export const CostTotalsDto = z.object({
  propertyId: z.uuid().nullable(),
  from: z.string(),
  to: z.string(),
  byKind: z.object({
    insurance_home: Money,
    insurance_life: Money,
    imi: Money,
    condominium: Money,
    other: Money,
  }),
  costs: Money,
  paid: Money,
  expected: Money,
  installmentInsurance: Money,
  total: Money,
  occurrences: z.array(OccurrenceDto),
});
export type CostTotalsDto = z.infer<typeof CostTotalsDto>;

export const toCostDto = (row: PropertyCostRow, nextDueDate: string | null): CostDto => ({
  id: row.id,
  propertyId: row.propertyId,
  kind: row.kind as CostDto['kind'],
  name: row.name,
  amount: row.amount,
  periodicity: row.periodicity as CostDto['periodicity'],
  intervalMonths: row.intervalMonths,
  startDate: row.startDate,
  endDate: row.endDate,
  accountId: row.accountId,
  annualAmount: annualAmount(row.amount, row.intervalMonths),
  nextDueDate,
});

export const toOccurrenceDto = (
  row: CostOccurrence,
  name: string | null,
  transactionId: string | null,
): OccurrenceDto => ({
  costId: row.costId,
  propertyId: row.propertyId,
  kind: row.kind,
  name,
  dueDate: row.dueDate,
  amount: row.amount,
  status: row.status,
  transactionId,
});

export const totalsFields = (totals: CostTotals) => ({
  byKind: totals.byKind,
  costs: totals.costs,
  paid: totals.paid,
  expected: totals.expected,
  installmentInsurance: totals.installmentInsurance,
  total: totals.total,
});
