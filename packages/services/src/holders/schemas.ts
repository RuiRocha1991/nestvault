import type { HolderRow } from '@nestvault/db';
import { z } from 'zod';

export const HOLDER_NAME_MAX = 60;
export const HOLDER_ALIASES_MAX = 10;
export const HOLDER_ALIAS_MIN = 3;
export const HOLDER_ALIAS_MAX = 60;

/** Upper case, no accents, single spaces: how a bank description is compared with an alias. */
export function normalizeAlias(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;

const Alias = z
  .string()
  .max(HOLDER_ALIAS_MAX * 2)
  .transform(normalizeAlias)
  .pipe(z.string().min(HOLDER_ALIAS_MIN).max(HOLDER_ALIAS_MAX).regex(NO_CONTROL));

/** At most 10 aliases of 3-60 characters; equal ones (after normalizing) are kept once. */
const Aliases = z
  .array(Alias)
  .max(HOLDER_ALIASES_MAX)
  .transform((aliases) => [...new Set(aliases)]);

const Name = z.string().trim().min(1).max(HOLDER_NAME_MAX).regex(NO_CONTROL);
const Color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/**
 * Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). Without a
 * colour the next unused one of the palette is chosen; `userId` links the holder to a member of
 * the pool, `null` unlinks.
 */
export const CreateHolderInput = z
  .object({
    name: Name,
    color: Color.optional(),
    aliases: Aliases.optional(),
    userId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateHolderInput = z.input<typeof CreateHolderInput>;

/** Fields left out stay as they are. */
export const UpdateHolderInput = z
  .object({
    name: Name.optional(),
    color: Color.optional(),
    aliases: Aliases.optional(),
    userId: z.uuid().nullable().optional(),
  })
  .strict();
export type UpdateHolderInput = z.input<typeof UpdateHolderInput>;

export const HolderDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  aliases: z.array(z.string()),
  userId: z.uuid().nullable(),
  /** True while the linked person is still a member of the pool: they cannot be removed here. */
  member: z.boolean(),
});
export type HolderDto = z.infer<typeof HolderDto>;

export const HolderListDto = z.object({ holders: z.array(HolderDto) });
export type HolderListDto = z.infer<typeof HolderListDto>;

export const toHolderDto = (row: HolderRow, memberIds: ReadonlySet<string>): HolderDto => ({
  id: row.id,
  name: row.name,
  color: row.color.toUpperCase(),
  aliases: row.aliases,
  userId: row.userId,
  member: row.userId !== null && memberIds.has(row.userId),
});

/** Merge a person added by hand into another one (usually the member): only the target is sent. */
export const MergeHolderInput = z.object({ intoId: z.uuid() }).strict();
export type MergeHolderInput = z.input<typeof MergeHolderInput>;

/** What a merge would do, shown before confirming. */
export const MergePreviewDto = z.object({
  /** Accounts the person owns: the target would own them. */
  accounts: z.number().int().nonnegative(),
  subAccounts: z.number().int().nonnegative(),
  /** Aliases of the person that the target does not have yet. */
  addedAliases: z.array(z.string()),
  /** True when the target would end with more than 10 aliases: the merge would answer 409. */
  tooManyAliases: z.boolean(),
});
export type MergePreviewDto = z.infer<typeof MergePreviewDto>;
