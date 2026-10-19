import type { CategoryRuleRow } from '@nestvault/db';
import { z } from 'zod';

export const RULES_MAX = 500;
export const PREVIEW_SAMPLE_MAX = 200;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
/** What to look for at the start of a word of the description (an IBAN is the safest keyword). */
const Keyword = z.string().trim().min(2).max(60).regex(NO_CONTROL);

/** Only client-editable fields (`.strict()`): the pool and the position are never the client's. */
export const CreateRuleInput = z
  .object({
    keyword: Keyword,
    categoryId: z.uuid(),
    accountId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateRuleInput = z.input<typeof CreateRuleInput>;

/** Fields left out stay as they are; `accountId: null` makes the rule apply to every account. */
export const UpdateRuleInput = z
  .object({ keyword: Keyword, categoryId: z.uuid(), accountId: z.uuid().nullable() })
  .partial()
  .strict();
export type UpdateRuleInput = z.input<typeof UpdateRuleInput>;

/** Every rule id of the pool, in the order they should be tried. */
export const ReorderRulesInput = z.object({ ids: z.array(z.uuid()).max(RULES_MAX) }).strict();
export type ReorderRulesInput = z.input<typeof ReorderRulesInput>;

/** `confirm: false` previews what the rules would change; `true` applies it. */
export const ApplyRulesInput = z.object({ confirm: z.boolean() }).strict();
export type ApplyRulesInput = z.input<typeof ApplyRulesInput>;

export const RuleDto = z.object({
  id: z.uuid(),
  keyword: z.string(),
  categoryId: z.uuid(),
  accountId: z.uuid().nullable(),
  position: z.number().int(),
});
export type RuleDto = z.infer<typeof RuleDto>;

export const RuleListDto = z.object({ rules: z.array(RuleDto) });
export type RuleListDto = z.infer<typeof RuleListDto>;

export const RuleChangeDto = z.object({
  transactionId: z.uuid(),
  description: z.string(),
  fromCategoryId: z.uuid().nullable(),
  toCategoryId: z.uuid(),
  /** The new transfer flag, or null when the rules leave it as it is. */
  transfer: z.boolean().nullable(),
});

export const ApplyRulesDto = z.object({
  /** Movements a rule matched (changed or not). */
  matched: z.number().int(),
  /** Movements whose category or transfer flag the rules change. */
  changed: z.number().int(),
  /** True once applied; false for a preview. */
  applied: z.boolean(),
  /** The first changes (at most 200), so a preview can be shown before confirming. */
  changes: z.array(RuleChangeDto),
});
export type ApplyRulesDto = z.infer<typeof ApplyRulesDto>;

export const toRuleDto = (row: CategoryRuleRow): RuleDto => ({
  id: row.id,
  keyword: row.keyword,
  categoryId: row.categoryId,
  accountId: row.accountId,
  position: row.position,
});
