import {
  FIELD_KINDS,
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
  type InstallmentAmounts,
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
  })
  .strict();
export type CreateFieldInput = z.input<typeof CreateFieldInput>;

const Decimal = z.string();

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

export function toLoanDto(
  row: LoanRow,
  fields: readonly LoanFieldRow[],
  installments: readonly InstallmentAmounts[],
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
    outstanding: outstandingBalance(row.principal, paid.capital),
    remainingInstallments: remainingInstallments(row.termMonths, installments.length),
  };
}
