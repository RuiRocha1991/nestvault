import type { CategoryRow, CategorySettingsRow } from '@nestvault/db';
import { GLOBAL_CATEGORY_KINDS } from '@nestvault/db';
import { toPlain } from '@nestvault/domain';
import { z } from 'zod';

export const CATEGORY_KINDS = GLOBAL_CATEGORY_KINDS;
export const DEFAULT_CATEGORY_COLOR = '#8C8FB8';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Name = z.string().trim().min(1).max(60).regex(NO_CONTROL);
const Color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
/** A monthly budget in EUR: zero or more, up to 4 decimals, a decimal string (never a float). */
const BUDGET = /^\d{1,14}(\.\d{1,4})?$/;
const Budget = z.string().refine((value) => BUDGET.test(value));

/**
 * Only client-editable fields (`.strict()`: `poolId`, `id`, `systemKey` and the rest answer 400).
 * A category created through the API always belongs to the pool of the URL.
 */
export const CreateCategoryInput = z
  .object({ name: Name, kind: z.enum(CATEGORY_KINDS), color: Color.optional() })
  .strict();
export type CreateCategoryInput = z.input<typeof CreateCategoryInput>;

/** Fields left out stay as they are. */
export const UpdateCategoryInput = z
  .object({ name: Name, kind: z.enum(CATEGORY_KINDS), color: Color })
  .partial()
  .strict();
export type UpdateCategoryInput = z.input<typeof UpdateCategoryInput>;

/** What the pool decides about any category it sees; fields left out stay, `null` clears. */
export const UpdateCategorySettingsInput = z
  .object({
    monthlyBudget: Budget.nullable(),
    colorOverride: Color.nullable(),
    hidden: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateCategorySettingsInput = z.input<typeof UpdateCategorySettingsInput>;

/** `?replacement=<category id>`: where the transactions of a deleted category go. */
export const DeleteCategoryQuery = z.object({ replacement: z.uuid().optional() }).strict();
export type DeleteCategoryQuery = z.input<typeof DeleteCategoryQuery>;

export const CategoryDto = z.object({
  id: z.uuid(),
  /** The stable key of a global category (its name comes from i18n); null for a pool's own. */
  systemKey: z.string().nullable(),
  /** The name of a pool's own category; null for a global one. */
  name: z.string().nullable(),
  kind: z.enum(CATEGORY_KINDS),
  /** The colour shown: the pool's override, else the category's own. */
  color: z.string(),
  colorOverride: z.string().nullable(),
  global: z.boolean(),
  /** This pool's monthly budget in EUR, a decimal string. */
  monthlyBudget: z.string().nullable(),
  hidden: z.boolean(),
});
export type CategoryDto = z.infer<typeof CategoryDto>;

export const CategoryListDto = z.object({ categories: z.array(CategoryDto) });
export type CategoryListDto = z.infer<typeof CategoryListDto>;

export const toCategoryDto = (
  row: CategoryRow,
  settings: CategorySettingsRow | undefined,
): CategoryDto => ({
  id: row.id,
  systemKey: row.systemKey,
  name: row.name,
  kind: row.kind as CategoryDto['kind'],
  color: settings?.colorOverride ?? row.color,
  colorOverride: settings?.colorOverride ?? null,
  global: row.poolId === null,
  monthlyBudget:
    settings?.monthlyBudget === null || settings?.monthlyBudget === undefined
      ? null
      : toPlain(settings.monthlyBudget),
  hidden: settings?.hidden ?? false,
});
