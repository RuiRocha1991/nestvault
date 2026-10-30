import { GOAL_MODES, GOAL_TYPES, type GoalRow, type GoalScopeRow } from '@nestvault/db';
import { dec, toPlain, type GoalResult } from '@nestvault/domain';
import { z } from 'zod';

export const GOAL_SCOPES_MAX = 60;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Name = z.string().trim().min(1).max(60).regex(NO_CONTROL);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A decimal string with up to 4 decimals (the column is numeric(18,4)); never a JS float. */
const Amount = z.string().refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value));
/** A percentage 0-100 with up to 4 decimals, as a decimal string. */
const Percent = z
  .string()
  .refine((value) => /^\d{1,3}(\.\d{1,4})?$/.test(value) && dec(value).lte(100));

export const GoalType = z.enum(GOAL_TYPES);
export const GoalMode = z.enum(GOAL_MODES);

/** One account (whole) or one sub-account of it. */
export const GoalAccountScope = z
  .object({ accountId: z.uuid(), subAccountId: z.uuid().nullable().optional() })
  .strict();
export type GoalAccountScope = z.infer<typeof GoalAccountScope>;

const Fields = {
  name: Name,
  color: Color,
  type: GoalType,
  target: Amount.refine((value) => dec(value).gt(0)),
  mode: GoalMode,
  deadline: z.iso.date().nullable(),
  monthly: Amount.nullable(),
  rate: Percent.nullable(),
  yield: Percent.nullable(),
  includeSavings: z.boolean(),
  portfolioIds: z.array(z.uuid()).max(GOAL_SCOPES_MAX),
  accounts: z.array(GoalAccountScope).max(GOAL_SCOPES_MAX),
};

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreateGoalInput = z
  .object({
    name: Fields.name,
    color: Fields.color,
    type: Fields.type,
    target: Fields.target,
    mode: Fields.mode.optional(),
    deadline: Fields.deadline.optional(),
    monthly: Fields.monthly.optional(),
    rate: Fields.rate.optional(),
    yield: Fields.yield.optional(),
    includeSavings: Fields.includeSavings.optional(),
    portfolioIds: Fields.portfolioIds.optional(),
    accounts: Fields.accounts.optional(),
  })
  .strict();
export type CreateGoalInput = z.input<typeof CreateGoalInput>;

export const UpdateGoalInput = z.object(Fields).partial().strict();
export type UpdateGoalInput = z.input<typeof UpdateGoalInput>;

const Decimal = z.string();

export const GoalPathPointDto = z.object({
  month: z.number().int(),
  planned: Decimal,
  required: Decimal.nullable(),
});

/** What the domain's `goalCalc` says about a goal, as decimal strings. */
export const GoalResultDto = z.object({
  mode: GoalMode,
  /** Current value of what the goal counts (a yearly income for `income`, the year's buys for `contrib`). */
  current: Decimal,
  target: Decimal,
  projected: Decimal.nullable(),
  /** Monthly contribution needed at the deadline. */
  required: Decimal.nullable(),
  reachIn: z.number().int().nullable(),
  /** `yyyy-mm` in which the target is reached. */
  etaMonth: z.string().nullable(),
  months: z.number().int(),
  /** 0-100. */
  progress: Decimal,
  done: z.boolean(),
  onTrack: z.boolean(),
  status: z.enum(['reached', 'on_track', 'behind', 'eta', 'no_contribution', 'tracking']),
  /** Yield used for an income goal, in percent; 0 otherwise. */
  yieldPct: Decimal,
  monthly: Decimal,
  path: z.array(GoalPathPointDto),
  /** Names of what the goal counts (portfolios or accounts), for the card. */
  scopeNames: z.array(z.string()),
  includesSavings: z.boolean(),
});
export type GoalResultDto = z.infer<typeof GoalResultDto>;

export const GoalDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  type: GoalType,
  target: Decimal,
  mode: GoalMode,
  deadline: z.string().nullable(),
  monthly: Decimal.nullable(),
  rate: Decimal.nullable(),
  yield: Decimal.nullable(),
  includeSavings: z.boolean(),
  portfolioIds: z.array(z.uuid()),
  accounts: z.array(z.object({ accountId: z.uuid(), subAccountId: z.uuid().nullable() })),
  result: GoalResultDto,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoalDto = z.infer<typeof GoalDto>;

export const GoalListDto = z.object({ asOf: z.string(), goals: z.array(GoalDto) });
export type GoalListDto = z.infer<typeof GoalListDto>;

export function toResultDto(result: GoalResult): GoalResultDto {
  return {
    mode: result.mode,
    current: toPlain(result.current),
    target: toPlain(result.target),
    projected: result.projected ? toPlain(result.projected) : null,
    required: result.required ? toPlain(result.required) : null,
    reachIn: result.reachIn,
    etaMonth: result.etaMonth,
    months: result.months,
    progress: toPlain(result.progress),
    done: result.done,
    onTrack: result.onTrack,
    status: result.status,
    yieldPct: toPlain(result.yld.times(100)),
    monthly: toPlain(result.monthly),
    path: result.path.map((point) => ({
      month: point.month,
      planned: toPlain(point.planned),
      required: point.required ? toPlain(point.required) : null,
    })),
    scopeNames: result.scope.names,
    includesSavings: result.scope.includesSavings,
  };
}

export function toGoalDto(
  row: GoalRow,
  scopes: readonly GoalScopeRow[],
  result: GoalResult,
): GoalDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    type: GoalType.parse(row.type),
    target: row.target,
    mode: GoalMode.parse(row.mode),
    deadline: row.deadline,
    monthly: row.monthly,
    rate: row.rate,
    yield: row.yield,
    includeSavings: row.includeSavings,
    portfolioIds: scopes.flatMap((scope) => (scope.portfolioId ? [scope.portfolioId] : [])),
    accounts: scopes.flatMap((scope) =>
      scope.accountId ? [{ accountId: scope.accountId, subAccountId: scope.subAccountId }] : [],
    ),
    result: toResultDto(result),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
