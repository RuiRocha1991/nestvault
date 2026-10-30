import {
  FIELD_KINDS,
  PREPAYMENT_EFFECT_KINDS,
  type LoanEventRow,
  LOAN_KINDS,
  RATE_INDEXES,
  RATE_TYPES,
  type LoanFieldRow,
  type LoanInstallmentAmountRow,
  type LoanInstallmentRow,
  type LoanRow,
} from '@nestvault/db';
import {
  BUILTIN_LOAN_FIELDS,
  dec,
  installmentTotal,
  outstandingBalance,
  remainingInstallments,
  totalsOf,
  type EventImpact,
  type InstallmentAmounts,
  type LoanEvent,
  type LoanFieldSetting,
} from '@nestvault/domain';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Name = z.string().trim().min(1).max(80).regex(NO_CONTROL);
const Label = z.string().trim().min(1).max(60).regex(NO_CONTROL);

/** A decimal string with up to 4 decimals (numeric(18,4)); never a JS float. */
const Amount = z.string().refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value));
const PositiveAmount = Amount.refine((value) => dec(value).gt(0));
/** A percentage 0-100 with up to 6 decimals (numeric(9,6)). */
const Percent = z
  .string()
  .refine((value) => /^\d{1,3}(\.\d{1,6})?$/.test(value) && dec(value).lte(100));
/** A spread over the index: may be negative. */
const Spread = z
  .string()
  .refine(
    (value) => /^-?\d{1,3}(\.\d{1,6})?$/.test(value) && dec(value).gte(-10) && dec(value).lte(100),
  );

export const LoanKind = z.enum(LOAN_KINDS);
export const RateType = z.enum(RATE_TYPES);
export const RateIndex = z.enum(RATE_INDEXES);

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreateLoanInput = z
  .object({
    name: Name,
    kind: LoanKind,
    propertyId: z.uuid().nullable().optional(),
    principal: PositiveAmount,
    startDate: z.iso.date(),
    firstDueDate: z.iso.date(),
    termMonths: z.number().int().min(1).max(600),
    rateType: RateType,
    rateIndex: RateIndex.nullable().optional(),
    spread: Spread.nullable().optional(),
    annualRate: Percent,
    fixedUntil: z.iso.date().nullable().optional(),
    reviewMonths: z.number().int().min(1).max(24).nullable().optional(),
    paymentDay: z.number().int().min(1).max(28),
    debitAccountId: z.uuid().nullable().optional(),
    taeg: Percent.nullable().optional(),
    tan: Percent.nullable().optional(),
  })
  .strict();
export type CreateLoanInput = z.input<typeof CreateLoanInput>;

export const UpdateLoanInput = CreateLoanInput.partial().strict();
export type UpdateLoanInput = z.input<typeof UpdateLoanInput>;

/** Custom-field amounts by field key. */
const CustomAmounts = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), Amount);

export const CreateInstallmentInput = z
  .object({
    number: z.number().int().min(1).max(600),
    dueDate: z.iso.date(),
    capital: Amount,
    interest: Amount,
    fees: Amount.optional(),
    stampTax: Amount.optional(),
    lifeInsurance: Amount.optional(),
    homeInsurance: Amount.optional(),
    creditInsurance: Amount.optional(),
    custom: CustomAmounts.optional(),
    status: z.enum(['scheduled', 'paid']).optional(),
  })
  .strict();
export type CreateInstallmentInput = z.input<typeof CreateInstallmentInput>;

export const UpdateInstallmentInput = CreateInstallmentInput.omit({ number: true })
  .partial()
  .strict();
export type UpdateInstallmentInput = z.input<typeof UpdateInstallmentInput>;

export const UpdateFieldInput = z
  .object({
    label: Label,
    enabled: z.boolean(),
    countsAsExpense: z.boolean(),
    defaultAmount: Amount.nullable(),
    appliesFrom: z.iso.date().nullable(),
  })
  .partial()
  .strict();
export type UpdateFieldInput = z.input<typeof UpdateFieldInput>;

export const CreateFieldInput = z
  .object({
    key: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/)
      .refine((key) => !(BUILTIN_LOAN_FIELDS as readonly string[]).includes(key)),
    label: Label,
    countsAsExpense: z.boolean().optional(),
    defaultAmount: Amount.nullable().optional(),
    /** First due date the default amount applies to. */
    appliesFrom: z.iso.date().nullable().optional(),
    /** Shown as a column and counted from the start; defaults to true. */
    enabled: z.boolean().optional(),
  })
  .strict();
export type CreateFieldInput = z.input<typeof CreateFieldInput>;

const Decimal = z.string();

/** A signed percentage with up to 6 decimals, from -10 to 100 (an index value can be negative). */
const SignedPercent = Spread;

const EventDate = z.iso.date();
export const PrepaymentEffect = z.enum(PREPAYMENT_EFFECT_KINDS);

/** One event of a loan. The pool and the loan come from the URL; `effectiveFrom` defaults per kind. */
export const CreateEventInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prepayment'),
      date: EventDate,
      effectiveFrom: EventDate.optional(),
      amount: PositiveAmount,
      fee: Amount.optional(),
      effect: PrepaymentEffect,
    })
    .strict(),
  z
    .object({
      kind: z.literal('rate_review'),
      date: EventDate,
      effectiveFrom: EventDate.optional(),
      indexValue: SignedPercent.optional(),
      spread: SignedPercent.optional(),
      annualRate: Percent,
      newInstallment: PositiveAmount.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('renegotiation'),
      date: EventDate,
      effectiveFrom: EventDate.optional(),
      spread: SignedPercent.optional(),
      annualRate: Percent.optional(),
      termMonths: z.number().int().min(1).max(600).optional(),
      newInstallment: PositiveAmount.optional(),
    })
    .strict()
    .refine((event) => event.annualRate !== undefined || event.termMonths !== undefined),
]);
export type CreateEventInput = z.input<typeof CreateEventInput>;

export const LoanFieldDto = z.object({
  id: z.uuid(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(FIELD_KINDS),
  enabled: z.boolean(),
  countsAsExpense: z.boolean(),
  defaultAmount: Decimal.nullable(),
  appliesFrom: z.iso.date().nullable(),
});
export type LoanFieldDto = z.infer<typeof LoanFieldDto>;

export const InstallmentDto = z.object({
  id: z.uuid(),
  loanId: z.uuid(),
  number: z.number().int(),
  dueDate: z.iso.date(),
  capital: Decimal,
  interest: Decimal,
  fees: Decimal,
  stampTax: Decimal,
  lifeInsurance: Decimal,
  homeInsurance: Decimal,
  creditInsurance: Decimal,
  custom: z.record(z.string(), Decimal),
  /** Capital + interest + the enabled fields. */
  total: Decimal,
  status: z.enum(['scheduled', 'paid']),
  source: z.enum(['manual', 'import']),
});
export type InstallmentDto = z.infer<typeof InstallmentDto>;

export const InstallmentListDto = z.object({ installments: z.array(InstallmentDto) });
export type InstallmentListDto = z.infer<typeof InstallmentListDto>;

const Totals = z.object({
  count: z.number().int(),
  capital: Decimal,
  interest: Decimal,
  fields: z.record(z.string(), Decimal),
  total: Decimal,
  costOfCredit: Decimal,
});

export const EventImpactDto = z.object({
  /** First installment that feels the event. */
  number: z.number().int(),
  paymentBefore: Decimal,
  paymentAfter: Decimal,
  remainingBefore: z.number().int(),
  remainingAfter: z.number().int(),
  annualRateBefore: Decimal,
  annualRateAfter: Decimal,
});

export const EventDto = z.object({
  id: z.uuid(),
  loanId: z.uuid(),
  kind: z.enum(['prepayment', 'rate_review', 'renegotiation']),
  date: z.iso.date(),
  effectiveFrom: z.iso.date(),
  amount: Decimal.nullable(),
  fee: Decimal.nullable(),
  effect: PrepaymentEffect.nullable(),
  indexValue: Decimal.nullable(),
  spread: Decimal.nullable(),
  annualRate: Decimal.nullable(),
  newInstallment: Decimal.nullable(),
  termMonths: z.number().int().nullable(),
  /** What it did to the installment and the term; `null` when the schedule does not reach it. */
  impact: EventImpactDto.nullable(),
});
export type EventDto = z.infer<typeof EventDto>;

export const EventListDto = z.object({ events: z.array(EventDto) });
export type EventListDto = z.infer<typeof EventListDto>;

export const ReviewPreviewDto = z.object({
  rateIndex: RateIndex,
  /** The month of the newest index value known, or `null` before the first run of the job. */
  indexPeriod: z.iso.date().nullable(),
  indexValue: Decimal.nullable(),
  spread: Decimal,
  currentRate: Decimal,
  /** Index plus spread, never below zero. */
  newRate: Decimal.nullable(),
  outstanding: Decimal,
  remainingInstallments: z.number().int(),
  currentPayment: Decimal,
  newPayment: Decimal.nullable(),
  nextReviewDate: z.iso.date().nullable(),
});
export type ReviewPreviewDto = z.infer<typeof ReviewPreviewDto>;

export const LoanDto = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: LoanKind,
  propertyId: z.uuid().nullable(),
  principal: Decimal,
  startDate: z.iso.date(),
  firstDueDate: z.iso.date(),
  termMonths: z.number().int(),
  rateType: RateType,
  rateIndex: RateIndex.nullable(),
  spread: Decimal.nullable(),
  annualRate: Decimal,
  fixedUntil: z.iso.date().nullable(),
  reviewMonths: z.number().int().nullable(),
  paymentDay: z.number().int(),
  debitAccountId: z.uuid().nullable(),
  taeg: Decimal.nullable(),
  tan: Decimal.nullable(),
  fields: z.array(LoanFieldDto),
  /** Derived from the installments entered so far. */
  paid: Totals,
  /** Capital paid off early by the prepayments recorded up to today. */
  prepaid: Decimal,
  outstanding: Decimal,
  remainingInstallments: z.number().int(),
});
export type LoanDto = z.infer<typeof LoanDto>;

export const LoanListDto = z.object({ loans: z.array(LoanDto) });
export type LoanListDto = z.infer<typeof LoanListDto>;

export const ScheduleRowDto = z.object({
  number: z.number().int(),
  dueDate: z.iso.date(),
  capital: Decimal,
  interest: Decimal,
  payment: Decimal,
  balanceAfter: Decimal,
  /** Nominal annual rate in force for the row. */
  annualRate: Decimal,
  source: z.enum(['actual', 'projected']),
});
export const ScheduleDto = z.object({
  schedule: z.array(ScheduleRowDto),
  byYear: z.array(Totals.extend({ year: z.number().int() })),
});
export type ScheduleDto = z.infer<typeof ScheduleDto>;

export const toFieldDto = (row: LoanFieldRow): LoanFieldDto => ({
  id: row.id,
  key: row.key,
  label: row.label,
  kind: row.kind === 'custom' ? 'custom' : 'builtin',
  enabled: row.enabled,
  countsAsExpense: row.countsAsExpense,
  defaultAmount: row.defaultAmount,
  appliesFrom: row.appliesFrom,
});

export const fieldSettings = (rows: readonly LoanFieldRow[]): LoanFieldSetting[] =>
  rows.map((row) => ({
    key: row.key,
    enabled: row.enabled,
    countsAsExpense: row.countsAsExpense,
  }));

/** The installment as the domain adds it up: built-in components and custom ones by key. */
export function toAmounts(
  row: LoanInstallmentRow,
  customRows: readonly LoanInstallmentAmountRow[],
  fields: readonly LoanFieldRow[],
): InstallmentAmounts {
  const custom = Object.fromEntries(
    customRows
      .filter((item) => item.installmentId === row.id)
      .flatMap((item) => {
        const field = fields.find((candidate) => candidate.id === item.fieldId);
        return field ? [[field.key, item.amount] as const] : [];
      }),
  );
  return {
    number: row.number,
    dueDate: row.dueDate,
    capital: row.capital,
    interest: row.interest,
    amounts: {
      fees: row.fees,
      stampTax: row.stampTax,
      lifeInsurance: row.lifeInsurance,
      homeInsurance: row.homeInsurance,
      creditInsurance: row.creditInsurance,
      ...custom,
    },
  };
}

export function toInstallmentDto(
  row: LoanInstallmentRow,
  customRows: readonly LoanInstallmentAmountRow[],
  fields: readonly LoanFieldRow[],
): InstallmentDto {
  const amounts = toAmounts(row, customRows, fields);
  const custom = Object.fromEntries(
    Object.entries(amounts.amounts ?? {}).filter(
      ([key]) => !(BUILTIN_LOAN_FIELDS as readonly string[]).includes(key),
    ),
  ) as Record<string, string>;
  return {
    id: row.id,
    loanId: row.loanId,
    number: row.number,
    dueDate: row.dueDate,
    capital: row.capital,
    interest: row.interest,
    fees: row.fees,
    stampTax: row.stampTax,
    lifeInsurance: row.lifeInsurance,
    homeInsurance: row.homeInsurance,
    creditInsurance: row.creditInsurance,
    custom,
    total: installmentTotal(amounts, fieldSettings(fields)),
    status: row.status === 'scheduled' ? 'scheduled' : 'paid',
    source: row.source === 'import' ? 'import' : 'manual',
  };
}

export const toDomainEvent = (row: LoanEventRow): LoanEvent => {
  if (row.kind === 'prepayment') {
    return {
      kind: 'prepayment',
      effectiveFrom: row.effectiveFrom,
      amount: row.amount ?? '0',
      effect: PrepaymentEffect.parse(row.effect),
    };
  }
  if (row.kind === 'rate_review') {
    return {
      kind: 'rate_review',
      effectiveFrom: row.effectiveFrom,
      annualPct: row.annualRate ?? '0',
      newInstallment: row.newInstallment,
    };
  }
  return {
    kind: 'renegotiation',
    effectiveFrom: row.effectiveFrom,
    annualPct: row.annualRate,
    termMonths: row.termMonths,
    newInstallment: row.newInstallment,
  };
};

export function toEventDto(row: LoanEventRow, impact: EventImpact | undefined): EventDto {
  return {
    id: row.id,
    loanId: row.loanId,
    kind: row.kind === 'prepayment' || row.kind === 'rate_review' ? row.kind : 'renegotiation',
    date: row.date,
    effectiveFrom: row.effectiveFrom,
    amount: row.amount,
    fee: row.fee,
    effect: row.effect ? PrepaymentEffect.parse(row.effect) : null,
    indexValue: row.indexValue,
    spread: row.spread,
    annualRate: row.annualRate,
    newInstallment: row.newInstallment,
    termMonths: row.termMonths,
    impact: impact
      ? {
          number: impact.number,
          paymentBefore: impact.paymentBefore,
          paymentAfter: impact.paymentAfter,
          remainingBefore: impact.remainingBefore,
          remainingAfter: impact.remainingAfter,
          annualRateBefore: impact.annualPctBefore,
          annualRateAfter: impact.annualPctAfter,
        }
      : null,
  };
}

export function toLoanDto(
  row: LoanRow,
  fields: readonly LoanFieldRow[],
  installments: readonly InstallmentAmounts[],
  prepaid: string,
): LoanDto {
  const paid = totalsOf(installments, fieldSettings(fields));
  return {
    id: row.id,
    name: row.name,
    kind: LoanKind.parse(row.kind),
    propertyId: row.propertyId,
    principal: row.principal,
    startDate: row.startDate,
    firstDueDate: row.firstDueDate,
    termMonths: row.termMonths,
    rateType: RateType.parse(row.rateType),
    rateIndex: row.rateIndex ? RateIndex.parse(row.rateIndex) : null,
    spread: row.spread,
    annualRate: row.annualRate,
    fixedUntil: row.fixedUntil,
    reviewMonths: row.reviewMonths,
    paymentDay: row.paymentDay,
    debitAccountId: row.debitAccountId,
    taeg: row.taeg,
    tan: row.tan,
    fields: fields.map(toFieldDto),
    paid,
    prepaid,
    outstanding: outstandingBalance(row.principal, paid.capital, prepaid),
    remainingInstallments: remainingInstallments(row.termMonths, installments.length),
  };
}

export const LinkInstallmentInput = z.object({ transactionId: z.uuid() }).strict();
export type LinkInstallmentInput = z.infer<typeof LinkInstallmentInput>;

/** An installment and the bank debit that paid it, with how the debit counts (NES-100). */
export const InstallmentLinkDto = z.object({
  installmentId: z.uuid(),
  transactionId: z.uuid(),
  /** What counts as an expense (interest, fees, taxes, insurances) and what is savings (capital). */
  split: z.object({ interest: z.string(), insurance: z.string(), capital: z.string() }),
});
export type InstallmentLinkDto = z.infer<typeof InstallmentLinkDto>;

export const MatchResultDto = z.object({
  matched: z.array(z.object({ installmentId: z.uuid(), transactionId: z.uuid() })),
});
export type MatchResultDto = z.infer<typeof MatchResultDto>;
