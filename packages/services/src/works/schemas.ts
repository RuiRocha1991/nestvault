import {
  PAYMENT_STATUSES,
  WORK_STATUSES,
  type WorksPaymentRow,
  type WorksProjectRow,
} from '@nestvault/db';
import { dec, depositAmount, paymentDelayDays, projectTotals } from '@nestvault/domain';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
// Free text a user writes: any character but control ones, kept as typed (escaped on render).
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const FREE_TEXT = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const Name = z.string().trim().min(1).max(80).regex(NO_CONTROL);
const Supplier = z.string().trim().min(1).max(80).regex(NO_CONTROL);
const PhaseDescription = z.string().trim().min(1).max(120).regex(NO_CONTROL);
const LongText = z.string().max(2000).regex(FREE_TEXT);

/** A decimal string with up to 4 decimals (numeric(18,4)); never a JS float. */
const Amount = z.string().refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value));
const PositiveAmount = Amount.refine((value) => dec(value).gt(0));
const Percent = z
  .string()
  .refine((value) => /^\d{1,3}(\.\d{1,6})?$/.test(value) && dec(value).lte(100));

export const WorkStatus = z.enum(WORK_STATUSES);
export const PaymentStatus = z.enum(PAYMENT_STATUSES);

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreateWorkInput = z
  .object({
    propertyId: z.uuid(),
    name: Name,
    description: LongText.nullable().optional(),
    supplier: Supplier.nullable().optional(),
    budget: Amount,
    depositPct: Percent.nullable().optional(),
    status: WorkStatus.optional(),
    startDate: z.iso.date().nullable().optional(),
    plannedEnd: z.iso.date().nullable().optional(),
    notes: LongText.nullable().optional(),
  })
  .strict();
export type CreateWorkInput = z.infer<typeof CreateWorkInput>;

/** The property of a project does not change: move the works by creating them again. */
export const UpdateWorkInput = CreateWorkInput.omit({ propertyId: true }).partial().strict();
export type UpdateWorkInput = z.infer<typeof UpdateWorkInput>;

export const CreatePaymentInput = z
  .object({
    description: PhaseDescription,
    amount: PositiveAmount,
    plannedDate: z.iso.date().nullable().optional(),
  })
  .strict();
export type CreatePaymentInput = z.infer<typeof CreatePaymentInput>;

/** A phase is marked paid by linking a movement or by `paidDate`; `status` follows from them. */
export const UpdatePaymentInput = z
  .object({
    description: PhaseDescription.optional(),
    amount: PositiveAmount.optional(),
    plannedDate: z.iso.date().nullable().optional(),
    paidDate: z.iso.date().nullable().optional(),
  })
  .strict();
export type UpdatePaymentInput = z.infer<typeof UpdatePaymentInput>;

export const LinkTransactionInput = z.object({ transactionId: z.uuid() }).strict();
export type LinkTransactionInput = z.infer<typeof LinkTransactionInput>;

const Money = z.string();

export const PaymentDto = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  description: z.string(),
  amount: Money,
  plannedDate: z.string().nullable(),
  paidDate: z.string().nullable(),
  status: PaymentStatus,
  transactionId: z.uuid().nullable(),
  /** Days paid after the planned date; negative when early. */
  delayDays: z.number().int().nullable(),
});
export type PaymentDto = z.infer<typeof PaymentDto>;

export const WorkTotalsDto = z.object({
  budget: Money,
  planned: Money,
  paid: Money,
  outstanding: Money,
  unplanned: Money,
  phases: z.number().int(),
  paidPhases: z.number().int(),
});

export const WorkDto = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  supplier: z.string().nullable(),
  budget: Money,
  depositPct: z.string().nullable(),
  /** The deposit asked up front, from the budget and the percentage. */
  depositAmount: Money.nullable(),
  status: WorkStatus,
  startDate: z.string().nullable(),
  plannedEnd: z.string().nullable(),
  notes: z.string().nullable(),
  totals: WorkTotalsDto,
  phases: z.array(PaymentDto),
});
export type WorkDto = z.infer<typeof WorkDto>;

export const PropertyWorksDto = z.object({
  propertyId: z.uuid(),
  projects: z.number().int(),
  byStatus: z.object({
    planned: z.number().int(),
    in_progress: z.number().int(),
    done: z.number().int(),
  }),
  budget: Money,
  paid: Money,
  outstanding: Money,
});

export const WorkListDto = z.object({
  projects: z.array(WorkDto),
  byProperty: z.array(PropertyWorksDto),
});
export type WorkListDto = z.infer<typeof WorkListDto>;

export const UpcomingPhaseDto = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  propertyId: z.uuid(),
  description: z.string(),
  amount: Money,
  plannedDate: z.string(),
});

export const UpcomingMonthDto = z.object({
  month: z.string(),
  amount: Money,
  phases: z.array(UpcomingPhaseDto),
});

export const UpcomingDto = z.object({ months: z.array(UpcomingMonthDto) });
export type UpcomingDto = z.infer<typeof UpcomingDto>;

export const toPaymentDto = (row: WorksPaymentRow): PaymentDto => ({
  id: row.id,
  projectId: row.projectId,
  description: row.description,
  amount: row.amount,
  plannedDate: row.plannedDate,
  paidDate: row.paidDate,
  status: row.status as PaymentDto['status'],
  transactionId: row.transactionId,
  delayDays: paymentDelayDays(row.plannedDate, row.paidDate),
});

const asPhase = (row: WorksPaymentRow) => ({
  amount: row.amount,
  status: row.status as 'planned' | 'paid',
  plannedDate: row.plannedDate,
  paidDate: row.paidDate,
});

export const toWorkDto = (row: WorksProjectRow, phases: readonly WorksPaymentRow[]): WorkDto => ({
  id: row.id,
  propertyId: row.propertyId,
  name: row.name,
  description: row.description,
  supplier: row.supplier,
  budget: row.budget,
  depositPct: row.depositPct,
  depositAmount: row.depositPct ? depositAmount(row.budget, row.depositPct) : null,
  status: row.status as WorkDto['status'],
  startDate: row.startDate,
  plannedEnd: row.plannedEnd,
  notes: row.notes,
  totals: projectTotals(row.budget, phases.map(asPhase)),
  phases: phases.map(toPaymentDto),
});
