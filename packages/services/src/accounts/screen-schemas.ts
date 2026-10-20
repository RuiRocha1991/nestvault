import { PERIOD_UNITS } from '@nestvault/db';
import { z } from 'zod';

import { ACCOUNT_TYPES, AccountDto } from './schemas';

const Amount = z.string();

export const InterestRowDto = z.object({
  id: z.string(),
  date: z.iso.date(),
  /** Net interest in the account currency. */
  amount: Amount,
  /** `manual` entries can be deleted; `statement` ones come from an imported movement. */
  source: z.enum(['manual', 'statement']),
});

export const InterestSummaryDto = z.object({
  /** Net interest received in the last 12 months and in total, in the account currency. */
  last12Months: Amount,
  total: Amount,
  /** Last-12-months interest over the average positive month-end balance, in percent; null when unknown. */
  effectiveRate: Amount.nullable(),
  /** Newest first, at most four. */
  recent: z.array(InterestRowDto),
});

export const PaymentDto = z.object({
  date: z.iso.date(),
  days: z.number().int(),
  gross: Amount,
  net: Amount,
  status: z.enum(['planned', 'paid']),
});

export const TermDepositDto = z.object({
  depositId: z.uuid(),
  productId: z.uuid().nullable(),
  capital: Amount,
  rate: Amount,
  start: z.iso.date(),
  maturity: z.iso.date().nullable(),
  payN: z.number().int().nullable(),
  payU: z.enum(PERIOD_UNITS).nullable(),
  termN: z.number().int().nullable(),
  termU: z.enum(PERIOD_UNITS).nullable(),
  scheduled: z.boolean(),
  capitalize: z.boolean(),
  /** The tax in force: the deposit's own, else the pool's default (percent). */
  tax: Amount,
  payToAccountId: z.uuid().nullable(),
  /** Where the capital goes back at maturity; null when nowhere. */
  returnToAccountId: z.uuid().nullable(),
  /** Gross interest up to today, tax withheld and net interest received. */
  gross: Amount,
  withheld: Amount,
  net: Amount,
  /** Interest accrued since the last payment (scheduled deposits). */
  accrued: Amount,
  /** Expected net interest over a year (capital x rate x (1 - tax)). */
  annualEstimate: Amount,
  next: z.object({ date: z.iso.date(), net: Amount }).nullable(),
  matured: z.boolean(),
  /** Share of the term already elapsed, 0-100; null for an open-ended deposit. */
  progress: z.number().int().min(0).max(100).nullable(),
  /** The two next payments (latest first) and the three last paid ones (newest first). */
  payments: z.array(PaymentDto),
});
export type TermDepositDto = z.infer<typeof TermDepositDto>;

const DividendsDto = z.object({
  gross: Amount,
  /** Withholding, as a positive amount. */
  tax: Amount,
  refund: Amount,
  net: Amount,
  net12Months: Amount,
});

export const BrokerageDto = z.object({
  trackCash: z.boolean(),
  /** Value of the open positions by asset currency, and in EUR. */
  valueBy: z.record(z.string(), Amount),
  valueEur: Amount,
  positions: z.number().int(),
  /** Total return over cost, in percent; null without positions. */
  totalPct: Amount.nullable(),
  subAccounts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      holderId: z.uuid().nullable(),
      valueEur: Amount,
      totalPct: Amount.nullable(),
    }),
  ),
  /** Money paid in and taken out (positive), in the account currency. */
  deposits: Amount,
  withdrawals: Amount,
  buys: Amount,
  sells: Amount,
  dividends: DividendsDto.nullable(),
});
export type BrokerageDto = z.infer<typeof BrokerageDto>;

export const AccountCardDto = AccountDto.extend({
  /** Number of imported or manual movements. */
  movements: z.number().int(),
  interest: InterestSummaryDto.nullable(),
  /** Term-deposit flows that reach this account and are not in the statement yet. */
  pendingDeposits: z
    .object({ amount: Amount, next: z.object({ date: z.iso.date(), amount: Amount }).nullable() })
    .nullable(),
  term: TermDepositDto.nullable(),
  brokerage: BrokerageDto.nullable(),
});
export type AccountCardDto = z.infer<typeof AccountCardDto>;

export const AccountsScreenDto = z.object({
  asOf: z.iso.date(),
  accounts: z.array(AccountCardDto),
  /** EUR total of each account type. */
  totalsEur: z.record(z.enum(ACCOUNT_TYPES), Amount),
});
export type AccountsScreenDto = z.infer<typeof AccountsScreenDto>;
