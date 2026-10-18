import { dec } from './decimal';
import { normalizeText } from './text';
import {
  findCategoryByKind,
  findCategoryBySystemKey,
  SYSTEM_KEYS,
  type Category,
  type Transaction,
} from './transactions';

/** A keyword rule. Rules are tried in array order (their position). */
export interface CategoryRule {
  id: string;
  keyword: string;
  categoryId: string;
  /** Restricts the rule to one account. */
  accountId?: string | null;
}

export interface RuleAccount {
  id: string;
  iban?: string | null;
}

export interface RuleContext {
  accounts: readonly RuleAccount[];
  categories: readonly Category[];
  rules: readonly CategoryRule[];
  /** Names the household's people are known by in transfers (already split, any case). */
  holderAliases: readonly string[];
}

export type RuleReason = 'own-iban' | 'holder-alias' | 'rule';

export interface RuleResult {
  categoryId: string;
  /** New value of the transfer flag, or `null` to leave it as it is (locked or already paired). */
  transfer: boolean | null;
  reason: RuleReason;
  ruleId?: string;
}

const LOOKS_LIKE_TRANSFER = /\b(TRF|TRANSF|TRANSFERENCIA|MB WAY)\b/;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const MIN_IBAN_LENGTH = 10;
const MIN_ALIAS_LENGTH = 2;
const SUGGEST_NOISE =
  /\b(COMPRA|ELEC|PAG\.?|PAGAMENTO|DD|TRF|SEPA\+?|INST|CR|LEV\.?|ATM|DE|P\/)\b/g;

const compactIban = (iban: string | null | undefined): string =>
  (iban ?? '').toUpperCase().replace(/\s/g, '');

/**
 * Whether the normalized keyword appears in the normalized description at the start of a word
 * (preceded by the start or by anything but a letter or digit): `REPSOL` matches
 * `COMPRA REPSOL LISBOA` but not `XREPSOL`.
 */
function keywordAtWordStart(description: string, keyword: string): boolean {
  if (!keyword) return false;
  let at = description.indexOf(keyword);
  while (at > -1) {
    if (at === 0 || !/[A-Z0-9]/.test(description.charAt(at - 1))) return true;
    at = description.indexOf(keyword, at + 1);
  }
  return false;
}

export function matchesKeyword(description: string, keyword: string): boolean {
  return keywordAtWordStart(normalizeText(description), normalizeText(keyword));
}

/** Everything `applyRules` derives from a context, computed once per context object. */
interface CompiledRules {
  ibanOwners: Map<string, string[]>;
  aliases: string[];
  rules: {
    id: string;
    keyword: string;
    categoryId: string;
    accountId: string | null;
    isTransfer: boolean;
  }[];
  transferCategoryId: string | null;
  refundCategoryId: string | null;
  externalCategoryId: string | null;
}

const compiled = new WeakMap<RuleContext, CompiledRules>();

/** The context is treated as immutable: build a new one when accounts, rules or aliases change. */
function compile(context: RuleContext): CompiledRules {
  const cached = compiled.get(context);
  if (cached) return cached;
  const { categories } = context;
  const ibanOwners = new Map<string, string[]>();
  for (const account of context.accounts) {
    const iban = compactIban(account.iban);
    if (iban.length > MIN_IBAN_LENGTH)
      ibanOwners.set(iban, [...(ibanOwners.get(iban) ?? []), account.id]);
  }
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  const result: CompiledRules = {
    ibanOwners,
    aliases: context.holderAliases.map(normalizeText).filter((a) => a.length > MIN_ALIAS_LENGTH),
    rules: context.rules
      .filter((r) => r.categoryId)
      .map((r) => ({
        id: r.id,
        keyword: normalizeText(r.keyword),
        categoryId: r.categoryId,
        accountId: r.accountId || null,
        isTransfer: kindById.get(r.categoryId) === 'transfer',
      }))
      .filter((r) => r.keyword),
    transferCategoryId: findCategoryByKind(categories, 'transfer')?.id ?? null,
    refundCategoryId: findCategoryByKind(categories, 'refund')?.id ?? null,
    externalCategoryId:
      (
        findCategoryBySystemKey(categories, SYSTEM_KEYS.externalTransfers) ??
        findCategoryBySystemKey(categories, SYSTEM_KEYS.otherExpenses)
      )?.id ?? null,
  };
  compiled.set(context, result);
  return result;
}

/**
 * The category a transaction gets from the household's own accounts and the keyword rules, or
 * `null` when nothing matches. A category chosen by hand is kept unless `force`.
 * Transfer-looking descriptions are checked first: the IBAN of another own account makes an
 * internal transfer; a household member's alias makes an outflow an expense sent to accounts
 * outside the app and an inflow a refund. Otherwise the first matching rule wins.
 */
export function applyRules(
  tx: Transaction,
  context: RuleContext,
  options: { force?: boolean } = {},
): RuleResult | null {
  if (tx.manualCategory && !options.force) return null;
  const description = normalizeText(tx.description);
  const compiledContext = compile(context);
  const mayChangeTransfer = !tx.transferLocked && !tx.pairId;
  const transferFlag = (value: boolean): boolean | null => (mayChangeTransfer ? value : null);

  if (LOOKS_LIKE_TRANSFER.test(description)) {
    const { transferCategoryId, ibanOwners } = compiledContext;
    const toOtherOwnAccount = (description.match(IBAN) ?? []).some((iban) =>
      ibanOwners.get(iban)?.some((owner) => owner !== tx.accountId),
    );
    if (transferCategoryId && toOtherOwnAccount) {
      return {
        categoryId: transferCategoryId,
        transfer: tx.transferLocked ? null : true,
        reason: 'own-iban',
      };
    }
    if (compiledContext.aliases.some((alias) => keywordAtWordStart(description, alias))) {
      const categoryId = dec(tx.amount).isNeg()
        ? compiledContext.externalCategoryId
        : compiledContext.refundCategoryId;
      if (categoryId) {
        return { categoryId, transfer: transferFlag(false), reason: 'holder-alias' };
      }
    }
  }

  for (const rule of compiledContext.rules) {
    if (rule.accountId && rule.accountId !== tx.accountId) continue;
    if (!keywordAtWordStart(description, rule.keyword)) continue;
    return {
      categoryId: rule.categoryId,
      transfer: transferFlag(rule.isTransfer),
      reason: 'rule',
      ruleId: rule.id,
    };
  }
  return null;
}

/** The IBAN in a description when there is one (the safest keyword), else its two main words. */
export function suggestKeyword(description: string): string {
  const normalized = normalizeText(description);
  const iban = normalized.match(IBAN)?.[0];
  if (iban) return iban;
  return normalized
    .replace(/^\d{2}\/\d{2}\s+/, '')
    .replace(SUGGEST_NOISE, ' ')
    .split(' ')
    .filter((word) => word.length > 2 && !/\d/.test(word))
    .slice(0, 2)
    .join(' ');
}

export interface RuleChange {
  transactionId: string;
  fromCategoryId: string | null;
  result: RuleResult;
  /** The category or the transfer flag would differ from what the transaction has now. */
  changed: boolean;
}

/** What the rules would do to each transaction, without applying anything. */
export function previewRules(
  transactions: readonly Transaction[],
  context: RuleContext,
  options: { force?: boolean } = {},
): RuleChange[] {
  const changes: RuleChange[] = [];
  for (const tx of transactions) {
    const result = applyRules(tx, context, options);
    if (!result) continue;
    changes.push({
      transactionId: tx.id,
      fromCategoryId: tx.categoryId ?? null,
      result,
      changed:
        result.categoryId !== (tx.categoryId ?? null) ||
        (result.transfer !== null && result.transfer !== !!tx.transfer),
    });
  }
  return changes;
}
