import { PERIOD_UNITS } from '@nestvault/db';
import type { DepositRow, InterestEntryRow, SavingsProductRow } from '@nestvault/db';
import {
  depositMaturity,
  dec,
  toPlain,
  type DepositPeriod,
  type DepositValue,
} from '@nestvault/domain';
import { z } from 'zod';

import { toDomainDeposit } from './domain';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Text = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);

const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const PERIOD_MAX = 3650;

/** Rate and tax: a percentage between 0 and 100 with up to 4 decimals. */
const Percent = z.string().refine((value) => PERCENT.test(value) && dec(value).lte(100));
const Capital = z.string().refine((value) => MONEY.test(value) && dec(value).gt(0));
const PeriodN = z.number().int().min(1).max(PERIOD_MAX);
const PeriodU = z.enum(PERIOD_UNITS);

/** A period is a number with its unit, or neither. */
const pairedPeriods = (value: {
  payN?: number | null | undefined;
  payU?: string | null | undefined;
  termN?: number | null | undefined;
  termU?: string | null | undefined;
}) =>
  (value.payN == null) === (value.payU == null) && (value.termN == null) === (value.termU == null);

/* ------------------------------------------------------------------ products */

const ProductFields = {
  name: Text(80),
  institution: Text(80).nullable(),
  rate: Percent,
  payN: PeriodN.nullable(),
  payU: PeriodU.nullable(),
  termN: PeriodN.nullable(),
  termU: PeriodU.nullable(),
  tax: Percent.nullable(),
  payToAccountId: z.uuid().nullable(),
  fundFromAccountId: z.uuid().nullable(),
};

/** Only client-editable fields (`.strict()`: the pool and the id answer 400). */
export const CreateProductInput = z
  .object({
    name: ProductFields.name,
    rate: ProductFields.rate,
    institution: ProductFields.institution.optional(),
    payN: ProductFields.payN.optional(),
    payU: ProductFields.payU.optional(),
    termN: ProductFields.termN.optional(),
    termU: ProductFields.termU.optional(),
    tax: ProductFields.tax.optional(),
    payToAccountId: ProductFields.payToAccountId.optional(),
    fundFromAccountId: ProductFields.fundFromAccountId.optional(),
  })
  .strict()
  .refine(pairedPeriods);
export type CreateProductInput = z.input<typeof CreateProductInput>;

export const UpdateProductInput = z
  .object(ProductFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type UpdateProductInput = z.input<typeof UpdateProductInput>;

export const ProductDto = z.object({
  id: z.uuid(),
  name: z.string(),
  institution: z.string().nullable(),
  rate: z.string(),
  payN: z.number().int().nullable(),
  payU: PeriodU.nullable(),
  termN: z.number().int().nullable(),
  termU: PeriodU.nullable(),
  tax: z.string().nullable(),
  payToAccountId: z.uuid().nullable(),
  fundFromAccountId: z.uuid().nullable(),
  /** Deposits made with this product, their total capital and the rate weighted by capital. */
  depositsCount: z.number().int(),
  capital: z.string(),
  averageRate: z.string().nullable(),
});
export type ProductDto = z.infer<typeof ProductDto>;

export const ProductListDto = z.object({ products: z.array(ProductDto) });
export type ProductListDto = z.infer<typeof ProductListDto>;

const optionalPlain = (value: string | null) => (value === null ? null : toPlain(value));

export const toProductDto = (
  row: SavingsProductRow,
  group: { depositsCount: number; capital: string; averageRate: string | null },
): ProductDto => ({
  id: row.id,
  name: row.name,
  institution: row.institution,
  rate: toPlain(row.rate),
  payN: row.payN,
  payU: row.payU as ProductDto['payU'],
  termN: row.termN,
  termU: row.termU as ProductDto['termU'],
  tax: optionalPlain(row.tax),
  payToAccountId: row.payToAccountId,
  fundFromAccountId: row.fundFromAccountId,
  ...group,
});

/* ------------------------------------------------------------------ deposits */

const DepositFields = {
  productId: z.uuid().nullable(),
  capital: Capital,
  start: z.iso.date(),
  rate: Percent,
  payN: PeriodN.nullable(),
  payU: PeriodU.nullable(),
  termN: PeriodN.nullable(),
  termU: PeriodU.nullable(),
  capitalize: z.boolean(),
  tax: Percent.nullable(),
  payToAccountId: z.uuid().nullable(),
  fundFromAccountId: z.uuid().nullable(),
};

/**
 * A deposit of a term-deposit account. With `productId`, every field left out is filled from the
 * product (`null` overrides it with "none"); without one, `rate` is required.
 */
export const CreateDepositInput = z
  .object({
    accountId: z.uuid(),
    capital: DepositFields.capital,
    start: DepositFields.start,
    productId: DepositFields.productId.optional(),
    rate: DepositFields.rate.optional(),
    payN: DepositFields.payN.optional(),
    payU: DepositFields.payU.optional(),
    termN: DepositFields.termN.optional(),
    termU: DepositFields.termU.optional(),
    capitalize: DepositFields.capitalize.optional(),
    tax: DepositFields.tax.optional(),
    payToAccountId: DepositFields.payToAccountId.optional(),
    fundFromAccountId: DepositFields.fundFromAccountId.optional(),
  })
  .strict();
export type CreateDepositInput = z.input<typeof CreateDepositInput>;

export const UpdateDepositInput = z
  .object(DepositFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type UpdateDepositInput = z.input<typeof UpdateDepositInput>;

export const DepositDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  productId: z.uuid().nullable(),
  capital: z.string(),
  start: z.iso.date(),
  rate: z.string(),
  payN: z.number().int().nullable(),
  payU: PeriodU.nullable(),
  termN: z.number().int().nullable(),
  termU: PeriodU.nullable(),
  capitalize: z.boolean(),
  tax: z.string().nullable(),
  payToAccountId: z.uuid().nullable(),
  fundFromAccountId: z.uuid().nullable(),
  /** Start plus the term; null for an open-ended deposit. */
  maturity: z.iso.date().nullable(),
});
export type DepositDto = z.infer<typeof DepositDto>;

export const DepositListDto = z.object({ deposits: z.array(DepositDto) });
export type DepositListDto = z.infer<typeof DepositListDto>;

export const toDepositDto = (row: DepositRow): DepositDto => ({
  id: row.id,
  accountId: row.accountId,
  productId: row.productId,
  capital: toPlain(row.capital),
  start: row.start,
  rate: toPlain(row.rate),
  payN: row.payN,
  payU: row.payU as DepositDto['payU'],
  termN: row.termN,
  termU: row.termU as DepositDto['termU'],
  capitalize: row.capitalize,
  tax: optionalPlain(row.tax),
  payToAccountId: row.payToAccountId,
  fundFromAccountId: row.fundFromAccountId,
  maturity: depositMaturity(toDomainDeposit(row)),
});

/** `?asOf=yyyy-mm-dd` (today when left out). */
export const ScheduleQuery = z.object({ asOf: z.iso.date().optional() }).strict();
export type ScheduleQuery = z.input<typeof ScheduleQuery>;

const PeriodDto = z.object({
  k: z.number().int(),
  date: z.iso.date(),
  days: z.number().int(),
  base: z.string(),
  gross: z.string(),
  net: z.string(),
});

export const DepositScheduleDto = z.object({
  depositId: z.uuid(),
  asOf: z.iso.date(),
  /** The pool's default tax (percent), used when the deposit has none of its own. */
  defaultTax: z.string(),
  periods: z.array(PeriodDto),
  value: z.object({
    capital: z.string(),
    gross: z.string(),
    net: z.string(),
    value: z.string(),
    paid: z.string(),
    accrued: z.string(),
    maturity: z.iso.date().nullable(),
    next: PeriodDto.nullable(),
    matured: z.boolean(),
    returned: z.boolean(),
  }),
});
export type DepositScheduleDto = z.infer<typeof DepositScheduleDto>;

const toPeriodDto = (period: DepositPeriod) => ({
  k: period.k,
  date: period.date,
  days: period.days,
  base: toPlain(period.base),
  gross: toPlain(period.gross),
  net: toPlain(period.net),
});

export const toScheduleDto = (
  depositId: string,
  asOf: string,
  defaultTax: string,
  periods: readonly DepositPeriod[],
  value: DepositValue,
): DepositScheduleDto => ({
  depositId,
  asOf,
  defaultTax: toPlain(defaultTax),
  periods: periods.map(toPeriodDto),
  value: {
    capital: toPlain(value.capital),
    gross: toPlain(value.gross),
    net: toPlain(value.net),
    value: toPlain(value.value),
    paid: toPlain(value.paid),
    accrued: toPlain(value.accrued),
    maturity: value.maturity,
    next: value.next ? toPeriodDto(value.next) : null,
    matured: value.matured,
    returned: value.returned,
  },
});

/* ------------------------------------------------------------------ interest */

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NOTE_CHARS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

/** Net interest received, in the account's currency. */
export const CreateInterestInput = z
  .object({
    accountId: z.uuid(),
    date: z.iso.date(),
    amount: z.string().refine((value) => MONEY.test(value) && dec(value).gt(0)),
    note: z.string().trim().min(1).max(500).regex(NOTE_CHARS).nullable().optional(),
  })
  .strict();
export type CreateInterestInput = z.input<typeof CreateInterestInput>;

export const ListInterestQuery = z.object({ accountId: z.uuid().optional() }).strict();
export type ListInterestQuery = z.input<typeof ListInterestQuery>;

export const InterestEntryDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  amount: z.string(),
  note: z.string().nullable(),
});
export type InterestEntryDto = z.infer<typeof InterestEntryDto>;

export const InterestListDto = z.object({ entries: z.array(InterestEntryDto) });
export type InterestListDto = z.infer<typeof InterestListDto>;

export const toInterestDto = (row: InterestEntryRow): InterestEntryDto => ({
  id: row.id,
  accountId: row.accountId,
  date: row.date,
  amount: toPlain(row.amount),
  note: row.note,
});
