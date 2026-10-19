import type { AccountRow, SubAccountRow } from '@nestvault/db';
import { dec, isValidIban, normalizeIban, roundTo, toPlain, type Dec } from '@nestvault/domain';
import { z } from 'zod';

export const ACCOUNT_TYPES = ['checking', 'savings', 'term_deposit', 'brokerage'] as const;
export const ACCOUNT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
export const ACCOUNT_HOLDERS_MAX = 20;
export const SUB_ACCOUNTS_MAX = 20;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Text = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);

/** A decimal string with up to 4 decimals (the column is numeric(18,4)); never a JS float. */
const Money = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/);
/** A percentage 0-100 with up to 4 decimals, as a decimal string. */
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const Percent = z.string().refine((value) => PERCENT.test(value) && dec(value).lte(100));

/** Stored without spaces and in upper case; the mod-97 check decides whether it is a real IBAN. */
const Iban = z.string().max(48).refine(isValidIban).transform(normalizeIban);

const HolderIds = z
  .array(z.uuid())
  .min(1)
  .max(ACCOUNT_HOLDERS_MAX)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length);

export const SubAccountInput = z
  .object({ name: Text(60), holderId: z.uuid().nullable().optional() })
  .strict();
export type SubAccountInput = z.input<typeof SubAccountInput>;

export const UpdateSubAccountInput = SubAccountInput.partial().strict();
export type UpdateSubAccountInput = z.input<typeof UpdateSubAccountInput>;

const AccountFields = {
  type: z.enum(ACCOUNT_TYPES),
  name: Text(80),
  institution: Text(80).nullable(),
  iban: Iban.nullable(),
  currency: z.enum(ACCOUNT_CURRENCIES),
  opening: Money,
  openingDate: z.iso.date().nullable(),
  trackCash: z.boolean(),
  groupName: Text(60).nullable(),
  portfolioId: z.uuid().nullable(),
  rate: Percent.nullable(),
  xtbAccountNo: Text(30).nullable(),
  holderIds: HolderIds,
};

/**
 * Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). `holderIds`
 * names who owns the account (at least one); `subAccounts` only for a brokerage account.
 */
export const CreateAccountInput = z
  .object({
    type: AccountFields.type,
    name: AccountFields.name,
    holderIds: AccountFields.holderIds,
    institution: AccountFields.institution.optional(),
    iban: AccountFields.iban.optional(),
    currency: AccountFields.currency,
    opening: AccountFields.opening.optional(),
    openingDate: AccountFields.openingDate.optional(),
    trackCash: AccountFields.trackCash.optional(),
    groupName: AccountFields.groupName.optional(),
    portfolioId: AccountFields.portfolioId.optional(),
    rate: AccountFields.rate.optional(),
    xtbAccountNo: AccountFields.xtbAccountNo.optional(),
    subAccounts: z.array(SubAccountInput).max(SUB_ACCOUNTS_MAX).optional(),
  })
  .strict();
export type CreateAccountInput = z.input<typeof CreateAccountInput>;

/** Fields left out stay as they are; sub-accounts have their own endpoints. */
export const UpdateAccountInput = z
  .object({
    type: AccountFields.type,
    name: AccountFields.name,
    holderIds: AccountFields.holderIds,
    institution: AccountFields.institution,
    iban: AccountFields.iban,
    currency: AccountFields.currency,
    opening: AccountFields.opening,
    openingDate: AccountFields.openingDate,
    trackCash: AccountFields.trackCash,
    groupName: AccountFields.groupName,
    portfolioId: AccountFields.portfolioId,
    rate: AccountFields.rate,
    xtbAccountNo: AccountFields.xtbAccountNo,
  })
  .partial()
  .strict();
export type UpdateAccountInput = z.input<typeof UpdateAccountInput>;

export const SubAccountDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  name: z.string(),
  holderId: z.uuid().nullable(),
});
export type SubAccountDto = z.infer<typeof SubAccountDto>;

export const AccountDto = z.object({
  id: z.uuid(),
  type: z.enum(ACCOUNT_TYPES),
  name: z.string(),
  institution: z.string().nullable(),
  iban: z.string().nullable(),
  currency: z.string(),
  opening: z.string(),
  openingDate: z.iso.date().nullable(),
  trackCash: z.boolean(),
  groupName: z.string().nullable(),
  portfolioId: z.uuid().nullable(),
  rate: z.string().nullable(),
  xtbAccountNo: z.string().nullable(),
  holderIds: z.array(z.uuid()),
  subAccounts: z.array(SubAccountDto),
  /** The balance today in the account's currency, a decimal string. */
  balance: z.string(),
  /** The same balance in EUR with the rates the pool uses today. */
  balanceEur: z.string(),
});
export type AccountDto = z.infer<typeof AccountDto>;

export const AccountListDto = z.object({ accounts: z.array(AccountDto) });
export type AccountListDto = z.infer<typeof AccountListDto>;

const plain = (value: Dec | string) => toPlain(value);

export const toSubAccountDto = (row: SubAccountRow): SubAccountDto => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  holderId: row.holderId,
});

export function toAccountDto(
  row: AccountRow,
  holderIds: readonly string[],
  subAccounts: readonly SubAccountRow[],
  balance: Dec,
  balanceEur: Dec,
): AccountDto {
  return {
    id: row.id,
    type: row.type as AccountDto['type'],
    name: row.name,
    institution: row.institution,
    iban: row.iban,
    currency: row.currency,
    opening: plain(row.opening),
    openingDate: row.openingDate,
    trackCash: row.trackCash,
    groupName: row.groupName,
    portfolioId: row.portfolioId,
    rate: row.rate === null ? null : plain(row.rate),
    xtbAccountNo: row.xtbAccountNo,
    holderIds: [...holderIds],
    subAccounts: subAccounts.map(toSubAccountDto),
    balance: plain(roundTo(balance, 4)),
    balanceEur: plain(roundTo(balanceEur, 4)),
  };
}
