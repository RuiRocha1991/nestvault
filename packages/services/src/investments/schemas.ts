import { INVESTMENT_OP_TYPES } from '@nestvault/db';
import type { InvestmentOpRow, PlanRow, PortfolioRow } from '@nestvault/db';
import { dec, toPlain, type PortfolioSummary } from '@nestvault/domain';
import { z } from 'zod';

import { ASSET_CURRENCIES } from '../assets/schemas';

const OPS_LIST_DEFAULT = 200;
const OPS_LIST_MAX = 1000;
const TARGETS_MAX = 50;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Text = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);
/** Notes may span lines; only the other control characters are refused. */
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NOTE_CHARS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const Note = z.string().trim().min(1).max(2000).regex(NOTE_CHARS);

const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const SIGNED_MONEY = /^-?\d{1,14}(\.\d{1,4})?$/;
const QTY = /^\d{1,12}(\.\d{1,8})?$/;
const PRICE = /^\d{1,12}(\.\d{1,6})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;

const Money = z.string().regex(MONEY);
const Qty = z.string().regex(QTY);
const Price = z.string().regex(PRICE);
/** Withholding tax is positive; a refund is negative. */
const Tax = z.string().regex(SIGNED_MONEY);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Target allocation: a label (asset class, ticker…) to a percentage between 0 and 100. */
export const Targets = z
  .record(
    Text(40),
    z.string().refine((value) => PERCENT.test(value) && dec(value).lte(100)),
  )
  .refine((value) => Object.keys(value).length <= TARGETS_MAX);

/* ------------------------------------------------------------------ portfolios */

const PortfolioFields = {
  name: Text(60),
  color: Color,
  currency: z.enum(ASSET_CURRENCIES),
  note: Note.nullable(),
  targets: Targets,
};

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreatePortfolioInput = z
  .object({
    name: PortfolioFields.name,
    color: PortfolioFields.color,
    currency: PortfolioFields.currency,
    note: PortfolioFields.note.optional(),
    targets: PortfolioFields.targets.optional(),
  })
  .strict();
export type CreatePortfolioInput = z.input<typeof CreatePortfolioInput>;

export const UpdatePortfolioInput = z.object(PortfolioFields).partial().strict();
export type UpdatePortfolioInput = z.input<typeof UpdatePortfolioInput>;

/**
 * `DELETE` of a portfolio that has operations or plans needs a decision: move them all to another
 * portfolio, or delete them all (`deleteOps=true`). Without one it answers 409.
 */
export const DeletePortfolioQuery = z
  .object({
    moveTo: z.uuid().optional(),
    deleteOps: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type DeletePortfolioQuery = z.input<typeof DeletePortfolioQuery>;

export const PortfolioDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  currency: z.string(),
  note: z.string().nullable(),
  targets: z.record(z.string(), z.string()),
  opsCount: z.number().int(),
  plansCount: z.number().int(),
});
export type PortfolioDto = z.infer<typeof PortfolioDto>;

export const PortfolioListDto = z.object({ portfolios: z.array(PortfolioDto) });
export type PortfolioListDto = z.infer<typeof PortfolioListDto>;

export const toPortfolioDto = (
  row: PortfolioRow,
  counts: { opsCount: number; plansCount: number },
): PortfolioDto => ({
  id: row.id,
  name: row.name,
  color: row.color,
  currency: row.currency,
  note: row.note,
  targets: Object.fromEntries(
    Object.entries(row.targets as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value),
    ]),
  ),
  ...counts,
});

/** `?asOf=yyyy-mm-dd` (today when left out); `portfolioId` narrows to one portfolio. */
export const SummaryQuery = z
  .object({ asOf: z.iso.date().optional(), portfolioId: z.uuid().optional() })
  .strict();
export type SummaryQuery = z.input<typeof SummaryQuery>;

const ByCurrencyDto = z.record(z.string(), z.string());

export const PortfolioSummaryDto = z.object({
  asOf: z.iso.date(),
  portfolioId: z.uuid().nullable(),
  /** Per-currency maps, decimal strings. */
  valueBy: ByCurrencyDto,
  costBy: ByCurrencyDto,
  gainBy: ByCurrencyDto,
  totalBy: ByCurrencyDto,
  divsBy: ByCurrencyDto,
  realizedBy: ByCurrencyDto,
  incomeBy: ByCurrencyDto,
  divs12By: ByCurrencyDto,
  divGrossBy: ByCurrencyDto,
  taxBy: ByCurrencyDto,
  refundBy: ByCurrencyDto,
  cashBy: ByCurrencyDto,
  otherBy: ByCurrencyDto,
  profitBy: ByCurrencyDto,
  valueAllBy: ByCurrencyDto,
  /** EUR totals, decimal strings. */
  valueAll: z.string(),
  profit: z.string(),
  netInvested: z.string(),
  profitPct: z.string(),
  cash: z.string(),
  value: z.string(),
  cost: z.string(),
  gain: z.string(),
  gainPct: z.string(),
  realized: z.string(),
  divs: z.string(),
  total: z.string(),
  totalPct: z.string(),
  income: z.string(),
  yld: z.string(),
  yoc: z.string(),
  divs12: z.string(),
  /** Annualised return; null when undefined. */
  irr: z.number().nullable(),
  positions: z.number().int(),
});
export type PortfolioSummaryDto = z.infer<typeof PortfolioSummaryDto>;

const byCurrency = (map: Record<string, { toFixed(): string }>) =>
  Object.fromEntries(
    Object.entries(map).map(([currency, value]) => [currency, toPlain(value.toFixed())]),
  );

export const toSummaryDto = (
  summary: PortfolioSummary,
  asOf: string,
  portfolioId: string | null,
): PortfolioSummaryDto => ({
  asOf,
  portfolioId,
  valueBy: byCurrency(summary.valueBy),
  costBy: byCurrency(summary.costBy),
  gainBy: byCurrency(summary.gainBy),
  totalBy: byCurrency(summary.totalBy),
  divsBy: byCurrency(summary.divsBy),
  realizedBy: byCurrency(summary.realizedBy),
  incomeBy: byCurrency(summary.incomeBy),
  divs12By: byCurrency(summary.divs12By),
  divGrossBy: byCurrency(summary.divGrossBy),
  taxBy: byCurrency(summary.taxBy),
  refundBy: byCurrency(summary.refundBy),
  cashBy: byCurrency(summary.cashBy),
  otherBy: byCurrency(summary.otherBy),
  profitBy: byCurrency(summary.profitBy),
  valueAllBy: byCurrency(summary.valueAllBy),
  valueAll: toPlain(summary.valueAll),
  profit: toPlain(summary.profit),
  netInvested: toPlain(summary.netInvested),
  profitPct: toPlain(summary.profitPct),
  cash: toPlain(summary.cash),
  value: toPlain(summary.value),
  cost: toPlain(summary.cost),
  gain: toPlain(summary.gain),
  gainPct: toPlain(summary.gainPct),
  realized: toPlain(summary.realized),
  divs: toPlain(summary.divs),
  total: toPlain(summary.total),
  totalPct: toPlain(summary.totalPct),
  income: toPlain(summary.income),
  yld: toPlain(summary.yld),
  yoc: toPlain(summary.yoc),
  divs12: toPlain(summary.divs12),
  irr: Number.isFinite(summary.irr) ? summary.irr : null,
  positions: summary.positions,
});

/* ------------------------------------------------------------------ operations */

const OpType = z.enum(INVESTMENT_OP_TYPES);

const OpFields = {
  portfolioId: z.uuid(),
  assetId: z.uuid(),
  accountId: z.uuid().nullable(),
  subAccountId: z.uuid().nullable(),
  type: OpType,
  date: z.iso.date(),
  qty: Qty.nullable(),
  price: Price.nullable(),
  fee: Money.nullable(),
  amount: Money.nullable(),
  gross: Money.nullable(),
  tax: Tax.nullable(),
  fromCash: z.boolean(),
  note: Note.nullable(),
};

/** Only client-editable fields: `extId`, `planId` and the pool are set by the server. */
export const CreateOpInput = z
  .object({
    portfolioId: OpFields.portfolioId,
    assetId: OpFields.assetId,
    type: OpFields.type,
    date: OpFields.date,
    accountId: OpFields.accountId.optional(),
    subAccountId: OpFields.subAccountId.optional(),
    qty: OpFields.qty.optional(),
    price: OpFields.price.optional(),
    fee: OpFields.fee.optional(),
    amount: OpFields.amount.optional(),
    gross: OpFields.gross.optional(),
    tax: OpFields.tax.optional(),
    fromCash: OpFields.fromCash.optional(),
    note: OpFields.note.optional(),
  })
  .strict();
export type CreateOpInput = z.input<typeof CreateOpInput>;

export const UpdateOpInput = z
  .object(OpFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type UpdateOpInput = z.input<typeof UpdateOpInput>;

export const ListOpsQuery = z
  .object({
    portfolioId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    accountId: z.uuid().optional(),
    type: OpType.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z.coerce.number().int().min(1).max(OPS_LIST_MAX).default(OPS_LIST_DEFAULT),
  })
  .strict();
export type ListOpsQuery = z.input<typeof ListOpsQuery>;

export const OpDto = z.object({
  id: z.uuid(),
  portfolioId: z.uuid(),
  assetId: z.uuid(),
  accountId: z.uuid().nullable(),
  subAccountId: z.uuid().nullable(),
  type: OpType,
  date: z.iso.date(),
  qty: z.string().nullable(),
  price: z.string().nullable(),
  fee: z.string().nullable(),
  amount: z.string().nullable(),
  gross: z.string().nullable(),
  tax: z.string().nullable(),
  fromCash: z.boolean(),
  planId: z.uuid().nullable(),
  note: z.string().nullable(),
});
export type OpDto = z.infer<typeof OpDto>;

export const OpListDto = z.object({ ops: z.array(OpDto) });
export type OpListDto = z.infer<typeof OpListDto>;

const plain = (value: string | null) => (value === null ? null : toPlain(value));

export const toOpDto = (row: InvestmentOpRow): OpDto => ({
  id: row.id,
  portfolioId: row.portfolioId,
  assetId: row.assetId,
  accountId: row.accountId,
  subAccountId: row.subAccountId,
  type: row.type as OpDto['type'],
  date: row.date,
  qty: plain(row.qty),
  price: plain(row.price),
  fee: plain(row.fee),
  amount: plain(row.amount),
  gross: plain(row.gross),
  tax: plain(row.tax),
  fromCash: row.fromCash,
  planId: row.planId,
  note: row.note,
});

/* ------------------------------------------------------------------ plans */

const PlanFields = {
  portfolioId: z.uuid(),
  assetId: z.uuid(),
  accountId: z.uuid().nullable(),
  subAccountId: z.uuid().nullable(),
  amount: z.string().refine((value) => MONEY.test(value) && dec(value).gt(0)),
  day: z.number().int().min(1).max(28),
  active: z.boolean(),
};

export const CreatePlanInput = z
  .object({
    portfolioId: PlanFields.portfolioId,
    assetId: PlanFields.assetId,
    amount: PlanFields.amount,
    day: PlanFields.day,
    accountId: PlanFields.accountId.optional(),
    subAccountId: PlanFields.subAccountId.optional(),
    active: PlanFields.active.optional(),
  })
  .strict();
export type CreatePlanInput = z.input<typeof CreatePlanInput>;

export const UpdatePlanInput = z.object(PlanFields).partial().strict();
export type UpdatePlanInput = z.input<typeof UpdatePlanInput>;

export const ListPlansQuery = z.object({ portfolioId: z.uuid().optional() }).strict();
export type ListPlansQuery = z.input<typeof ListPlansQuery>;

/** Running a plan: the month defaults to the current one. */
export const RunPlanInput = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();
export type RunPlanInput = z.input<typeof RunPlanInput>;

export const PlanDto = z.object({
  id: z.uuid(),
  portfolioId: z.uuid(),
  assetId: z.uuid(),
  accountId: z.uuid().nullable(),
  subAccountId: z.uuid().nullable(),
  amount: z.string(),
  day: z.number().int(),
  active: z.boolean(),
});
export type PlanDto = z.infer<typeof PlanDto>;

export const PlanListDto = z.object({ plans: z.array(PlanDto) });
export type PlanListDto = z.infer<typeof PlanListDto>;

export const toPlanDto = (row: PlanRow): PlanDto => ({
  id: row.id,
  portfolioId: row.portfolioId,
  assetId: row.assetId,
  accountId: row.accountId,
  subAccountId: row.subAccountId,
  amount: toPlain(row.amount),
  day: row.day,
  active: row.active,
});

export const PlanRunDto = z.object({
  /** `false` when the month had already been registered: the existing buy comes back. */
  created: z.boolean(),
  op: OpDto,
});
export type PlanRunDto = z.infer<typeof PlanRunDto>;
