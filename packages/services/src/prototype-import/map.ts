import type {
  AccountValues,
  AssetValues,
  CategorySettingsValues,
  CategoryValues,
  DepositValues,
  ImportedTransactionValues,
  InterestEntryValues,
  InvestmentOpValues,
  PlanValues,
  PortfolioCashMoveValues,
  PortfolioValues,
  PriceValues,
  RuleValues,
  SavingsProductValues,
} from '@nestvault/db';
import {
  dec,
  isValidIban,
  normalizeIban,
  normalizeText,
  toPlain,
  transactionHash,
} from '@nestvault/domain';

import { ValidationError } from '../errors';
import { nextHolderColor } from '../holders/palette';
import { normalizeAlias } from '../holders/schemas';

import { migrateLists } from './migrate';
import type { PrototypeExport, WarningCode } from './schema';
import {
  Findings,
  hexColor,
  isoDate,
  money,
  multiLine,
  oneLine,
  percent,
  quantity,
  uniqueName,
  unitPrice,
  whole,
} from './values';

// Turns a prototype export into everything the importer will write, with new ids, and counts what
// it dropped on the way. Pure: no database, no clock; ids come from `newId` and the pool's current
// state (people, global categories) is passed in. The dry run stops here; the commit writes the plan.

const ACCOUNT_TYPES: Record<string, string> = {
  ordem: 'checking',
  remunerada: 'savings',
  prazo: 'term_deposit',
  corretora: 'brokerage',
};
const ASSET_TYPES: Record<string, string> = {
  acao: 'stock',
  etf: 'etf',
  fundo: 'fund',
  reit: 'reit',
  ppr: 'ppr',
  obrigacao: 'bond',
  cripto: 'crypto',
  outro: 'other',
};
const ENGLISH_ASSET_TYPES = new Set([
  'stock',
  'etf',
  'fund',
  'reit',
  'ppr',
  'bond',
  'crypto',
  'other',
]);
const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CHF']);
const CATEGORY_KINDS = new Set(['expense', 'income', 'refund', 'transfer', 'invest']);
/** Accounts an investment can settle in (the services' rule, `CASH_ACCOUNT_TYPES`). */
const CASH_TYPES = new Set(['brokerage', 'checking']);

/** The prototype's default categories (by name) and the global category each one became (ADR 0004). */
const DEFAULT_CATEGORY_KEYS: Record<string, string> = {
  habitacao: 'housing',
  supermercado: 'groceries',
  restauracao: 'dining',
  transportes: 'transport',
  combustivel: 'fuel',
  'utilidades (luz, agua, gas)': 'utilities',
  telecomunicacoes: 'telecoms',
  subscricoes: 'subscriptions',
  saude: 'health',
  educacao: 'education',
  seguros: 'insurance',
  compras: 'shopping',
  'lazer e viagens': 'leisure-travel',
  'desporto e ginasio': 'sports',
  impostos: 'taxes',
  'levantamentos (numerario)': 'cash-withdrawals',
  'comissoes bancarias': 'bank-fees',
  'outras despesas': 'other-expenses',
  salario: 'salary',
  'juros e dividendos': 'interest',
  'outros rendimentos': 'other-income',
  'envios para contas proprias fora da app': 'external-transfers',
  reembolsos: 'refunds',
  'transferencia interna': 'internal-transfer',
  investimento: 'investment',
};

export interface GlobalCategoryInfo {
  id: string;
  systemKey: string;
  kind: string;
  color: string;
}

export interface ExistingHolder {
  id: string;
  name: string;
}

export interface PlanInput {
  data: PrototypeExport;
  existingHolders: readonly ExistingHolder[];
  globalCategories: readonly GlobalCategoryInfo[];
  newId: () => string;
}

/** What one import creates, per entity. Every key is always present. */
export interface ImportCounts {
  holders: number;
  holdersMatched: number;
  accounts: number;
  subAccounts: number;
  savingsProducts: number;
  deposits: number;
  categories: number;
  categorySettings: number;
  rules: number;
  transactions: number;
  transferPairs: number;
  assets: number;
  assetPrices: number;
  portfolios: number;
  plans: number;
  investmentOps: number;
  cashMoves: number;
  interestEntries: number;
  goalsSkipped: number;
}

export interface ImportPlan {
  newHolders: { id: string; name: string; color: string; aliases: string[] }[];
  portfolios: { id: string; values: PortfolioValues }[];
  accounts: {
    id: string;
    values: AccountValues;
    holderIds: string[];
    subAccounts: { id: string; name: string; holderId: string | null }[];
  }[];
  products: { id: string; values: SavingsProductValues }[];
  deposits: { id: string; accountId: string; values: DepositValues }[];
  assets: { id: string; values: AssetValues }[];
  /** History prices (`bulk`) first, then the current price of each asset (`manual`). */
  historyPrices: PriceValues[];
  currentPrices: PriceValues[];
  categories: { id: string; values: CategoryValues }[];
  categorySettings: { categoryId: string; values: CategorySettingsValues }[];
  rules: (RuleValues & { id: string })[];
  transactions: ImportedTransactionValues[];
  pairs: { id: string; pairId: string }[];
  plans: { id: string; values: PlanValues }[];
  ops: (InvestmentOpValues & { id: string })[];
  cashMoves: { id: string; values: PortfolioCashMoveValues }[];
  interest: { id: string; values: InterestEntryValues }[];
  /** `null` when the file carries no settings. */
  settings: {
    transferWindowDays: number | null;
    depositTax: string | null;
    dividendTax: string | null;
    fxOverrides: Record<string, string>;
  } | null;
  counts: ImportCounts;
  warnings: { code: WarningCode; count: number }[];
}

type Maybe<T> = T | null | undefined;

/** Keeps the first row of each prototype id; later duplicates are counted and dropped. */
function firstOfEach<T extends { id: string }>(rows: Maybe<readonly T[]>, found: Findings): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows ?? []) {
    if (seen.has(row.id)) {
      found.warn('duplicate_skipped');
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { data, newId } = input;
  const found = new Findings();
  const lists = migrateLists(data);
  if (lists.rulesAdded > 0) found.warn('default_rules_added', lists.rulesAdded);

  /* ------------------------------------------------------------- people */
  const holderIdOf = new Map<string, string>();
  const newHolders: ImportPlan['newHolders'] = [];
  const claimed = new Set<string>();
  const usedColors = [] as string[];
  let holdersMatched = 0;
  for (const [index, member] of firstOfEach(data.members, found).entries()) {
    const name = oneLine(member.name, 60) || `Pessoa ${index + 1}`;
    const same = input.existingHolders.find(
      (holder) => !claimed.has(holder.id) && normalizeText(holder.name) === normalizeText(name),
    );
    if (same) {
      claimed.add(same.id);
      holderIdOf.set(member.id, same.id);
      holdersMatched += 1;
      found.warn('holder_matched');
      continue;
    }
    const color = hexColor(member.color) ?? nextHolderColor(usedColors);
    usedColors.push(color);
    const aliasText = Array.isArray(member.aliases)
      ? member.aliases.join(',')
      : (member.aliases ?? '');
    const aliases = [
      ...new Set(
        aliasText
          .split(/[,;\n]/)
          .map((alias) => normalizeAlias(oneLine(alias, 60)))
          .filter((alias) => alias.length >= 3 && alias.length <= 60),
      ),
    ].slice(0, 10);
    const id = newId();
    holderIdOf.set(member.id, id);
    newHolders.push({ id, name, color: color.toUpperCase(), aliases });
  }
  const fallbackHolder = newHolders[0]?.id ?? input.existingHolders[0]?.id ?? null;

  /* ---------------------------------------------------------- portfolios */
  const portfolioIdOf = new Map<string, string>();
  const portfolios: ImportPlan['portfolios'] = [];
  const portfolioNames = new Set<string>();
  const portfolioRows = firstOfEach(data.portfolios, found);
  const assetRows = firstOfEach(data.assets, found);
  const assetIdOf = new Map<string, string>();
  for (const asset of assetRows) assetIdOf.set(asset.id, newId());
  for (const [index, portfolio] of portfolioRows.entries()) {
    const currency = oneLine(portfolio.ccy, 3).toUpperCase() || 'EUR';
    if (!CURRENCIES.has(currency)) {
      found.issue(`export.portfolios.${index}.ccy`, 'unsupported currency');
      continue;
    }
    const id = newId();
    portfolioIdOf.set(portfolio.id, id);
    const targets: Record<string, string> = {};
    for (const [assetKey, share] of Object.entries(portfolio.targets ?? {})) {
      const asset = assetIdOf.get(assetKey);
      const pct = percent(share);
      if (asset && pct !== null) targets[asset] = pct;
    }
    const note = multiLine(portfolio.note, 2000);
    portfolios.push({
      id,
      values: {
        name: uniqueName(oneLine(portfolio.name, 60) || 'Portfolio', portfolioNames, 60),
        color: hexColor(portfolio.color) ?? '#9D6BFF',
        currency,
        note: note || null,
        targets,
      },
    });
  }

  /* ------------------------------------------------------------ accounts */
  const accountRows = firstOfEach(data.accounts, found);
  const accountIdOf = new Map<string, string>();
  const accountTypeOf = new Map<string, string>();
  for (const account of accountRows) {
    accountIdOf.set(account.id, newId());
    accountTypeOf.set(account.id, ACCOUNT_TYPES[oneLine(account.type, 20)] ?? '');
  }
  const productRows = firstOfEach(data.products, found);
  const productIdOf = new Map<string, string>();
  for (const product of productRows) productIdOf.set(product.id, newId());

  const accounts: ImportPlan['accounts'] = [];
  const subIdOf = new Map<string, string>(); // `${accountId}|${subId}` → new sub-account id
  const ibans = new Set<string>();
  for (const [index, account] of accountRows.entries()) {
    const path = `export.accounts.${index}`;
    const type = accountTypeOf.get(account.id) ?? '';
    if (!type) {
      found.issue(`${path}.type`, 'unknown account type');
      continue;
    }
    const currency =
      type === 'term_deposit' ? 'EUR' : oneLine(account.ccy, 3).toUpperCase() || 'EUR';
    if (!CURRENCIES.has(currency)) {
      found.issue(`${path}.ccy`, 'unsupported currency');
      continue;
    }
    const id = accountIdOf.get(account.id) ?? newId();
    const owners = [
      ...new Set(
        [...(account.members ?? []), ...(account.member ? [account.member] : [])]
          .map((memberId) => holderIdOf.get(memberId))
          .filter((holder): holder is string => !!holder),
      ),
    ].slice(0, 20);
    if (owners.length === 0) {
      if (!fallbackHolder) {
        found.issue(`${path}.members`, 'the account has no owner and the file has no people');
        continue;
      }
      owners.push(fallbackHolder);
      found.warn('account_owner_defaulted');
    }

    let iban: string | null = null;
    if (typeof account.iban === 'string' && account.iban.trim() !== '') {
      const normalized = normalizeIban(account.iban);
      if (isValidIban(normalized) && normalized.length <= 34 && !ibans.has(normalized)) {
        iban = normalized;
        ibans.add(normalized);
      } else {
        found.warn('iban_dropped');
      }
    }

    const subAccounts: { id: string; name: string; holderId: string | null }[] = [];
    if (type === 'brokerage') {
      const names = new Set<string>();
      for (const sub of account.subs ?? []) {
        if (subIdOf.has(`${account.id}|${sub.id}`)) {
          found.warn('duplicate_skipped');
          continue;
        }
        const holder = sub.member ? (holderIdOf.get(sub.member) ?? null) : null;
        const subId = newId();
        subIdOf.set(`${account.id}|${sub.id}`, subId);
        subAccounts.push({
          id: subId,
          name: uniqueName(oneLine(sub.name, 60) || 'Subconta', names, 60),
          holderId: holder && owners.includes(holder) ? holder : null,
        });
        if (holder && !owners.includes(holder)) found.warn('sub_account_dropped');
      }
    } else if ((account.subs ?? []).length > 0) {
      found.warn('sub_account_dropped', account.subs?.length ?? 0);
    }

    const portfolioId = account.pf ? (portfolioIdOf.get(account.pf) ?? null) : null;
    if (account.pf && !portfolioId) found.warn('account_reference_dropped');
    accounts.push({
      id,
      holderIds: owners,
      subAccounts,
      values: {
        type,
        name: oneLine(account.name, 80) || 'Conta',
        institution: oneLine(account.bank, 80) || null,
        iban,
        currency,
        opening: money(account.opening) ?? '0',
        openingDate: isoDate(account.openingDate),
        trackCash: account.trackCash ?? true,
        groupName: oneLine(account.group, 60) || null,
        portfolioId,
        // A term deposit's rate lives on its deposit; a checking account has none.
        rate: type === 'savings' ? percent(account.rate) : null,
        xtbAccountNo: oneLine(account.xtb, 30) || null,
      },
    });
  }
  const importedAccounts = new Set(accounts.map((account) => account.id));
  const importedAccountOf = (protoId: Maybe<string>): string | null => {
    const id = protoId ? accountIdOf.get(protoId) : undefined;
    return id && importedAccounts.has(id) ? id : null;
  };

  /* ------------------------------------------------- savings products */
  /** Where interest goes or money comes from: an imported account that is not a term deposit. */
  const fundingAccount = (protoId: Maybe<string>): string | null => {
    const id = importedAccountOf(protoId);
    if (!protoId) return null;
    if (!id || accountTypeOf.get(protoId) === 'term_deposit') {
      found.warn('account_reference_dropped');
      return null;
    }
    return id;
  };
  const period = (n: unknown, unit: unknown): { n: number | null; u: string | null } => {
    const count = whole(n);
    if (count === null || count < 1 || count > 3650) return { n: null, u: null };
    return { n: count, u: unit === 'd' ? 'd' : 'm' };
  };

  const products: ImportPlan['products'] = [];
  const productNames = new Set<string>();
  const importedProducts = new Set<string>();
  for (const product of productRows) {
    const rate = percent(product.rate);
    if (rate === null) {
      found.warn('product_skipped');
      continue;
    }
    const pay = period(product.payN, product.payU);
    const term = period(product.termN, product.termU);
    const id = productIdOf.get(product.id) ?? newId();
    importedProducts.add(product.id);
    products.push({
      id,
      values: {
        name: uniqueName(oneLine(product.name, 80) || 'Produto', productNames, 80),
        institution: oneLine(product.bank, 80) || null,
        rate,
        payN: pay.n,
        payU: pay.u,
        termN: term.n,
        termU: term.u,
        tax: percent(product.tax),
        payToAccountId: fundingAccount(product.payTo),
        fundFromAccountId: fundingAccount(product.fundFrom),
      },
    });
  }

  /* ------------------------------------------------------------ deposits */
  const deposits: ImportPlan['deposits'] = [];
  for (const account of accountRows) {
    const newAccountId = importedAccountOf(account.id);
    if (!newAccountId || accountTypeOf.get(account.id) !== 'term_deposit') continue;
    const capital = money(account.capital);
    const start = isoDate(account.start) ?? isoDate(account.openingDate);
    const rate = percent(account.rate);
    if (capital === null || !dec(capital).gt(0) || !start || rate === null) {
      found.warn('deposit_skipped');
      continue;
    }
    const pay = period(account.payN, account.payU);
    // Files from before v5 stored the term in months only.
    const term =
      account.termN !== undefined && account.termN !== null
        ? period(account.termN, account.termU)
        : period(account.termMonths, 'm');
    deposits.push({
      id: newId(),
      accountId: newAccountId,
      values: {
        productId:
          account.product && importedProducts.has(account.product)
            ? (productIdOf.get(account.product) ?? null)
            : null,
        capital,
        start,
        rate,
        payN: pay.n,
        payU: pay.u,
        termN: term.n,
        termU: term.u,
        capitalize: account.capitalize ?? false,
        tax: percent(account.tax),
        payToAccountId: fundingAccount(account.payTo),
        fundFromAccountId: fundingAccount(account.fundFrom),
      },
    });
  }

  /* ---------------------------------------------------------- categories */
  const globalByKey = new Map(input.globalCategories.map((global) => [global.systemKey, global]));
  const categoryIdOf = new Map<string, string>();
  const categories: ImportPlan['categories'] = [];
  const categorySettings: ImportPlan['categorySettings'] = [];
  const categoryNames = new Set<string>();
  const usedGlobals = new Set<string>();
  for (const category of firstOfEach(lists.categories, found)) {
    const name = oneLine(category.name, 60);
    if (!name) {
      found.warn('category_reference_dropped');
      continue;
    }
    const kind = CATEGORY_KINDS.has(oneLine(category.kind, 20))
      ? oneLine(category.kind, 20)
      : 'expense';
    const budget = money(category.budget);
    const monthlyBudget = budget !== null && dec(budget).gt(0) ? budget : null;
    const key = DEFAULT_CATEGORY_KEYS[normalizeText(name).toLowerCase()];
    const global = key ? globalByKey.get(key) : undefined;
    if (global && global.kind === kind) {
      if (usedGlobals.has(global.id)) found.warn('category_merged');
      categoryIdOf.set(category.id, global.id);
      if (!usedGlobals.has(global.id)) {
        usedGlobals.add(global.id);
        const color = hexColor(category.color);
        const override = color && color.toUpperCase() !== global.color.toUpperCase() ? color : null;
        if (monthlyBudget !== null || override !== null) {
          categorySettings.push({
            categoryId: global.id,
            values: { monthlyBudget, colorOverride: override, hidden: false },
          });
        }
      }
      continue;
    }
    const id = newId();
    categoryIdOf.set(category.id, id);
    categories.push({
      id,
      values: {
        name: uniqueName(name, categoryNames, 60),
        kind,
        color: hexColor(category.color) ?? '#8C8FB8',
      },
    });
    if (monthlyBudget !== null) {
      categorySettings.push({
        categoryId: id,
        values: { monthlyBudget, colorOverride: null, hidden: false },
      });
    }
  }
  const categoryOf = (protoId: Maybe<string>): string | null => {
    if (!protoId) return null;
    const id = categoryIdOf.get(protoId);
    if (!id) found.warn('category_reference_dropped');
    return id ?? null;
  };

  /* --------------------------------------------------------------- rules */
  const rules: ImportPlan['rules'] = [];
  for (const rule of firstOfEach(lists.rules, found)) {
    const keyword = oneLine(rule.kw, 60);
    const categoryId = rule.cat ? (categoryIdOf.get(rule.cat) ?? null) : null;
    const accountId = rule.acc ? importedAccountOf(rule.acc) : null;
    if (keyword.length < 2 || !categoryId || (rule.acc && !accountId)) {
      found.warn('rule_skipped');
      continue;
    }
    rules.push({ id: newId(), keyword, categoryId, accountId });
  }

  /* -------------------------------------------------------- transactions */
  const txRows = firstOfEach(data.tx, found);
  const txIdOf = new Map<string, string>();
  const transactions: ImportedTransactionValues[] = [];
  const occurrences = new Map<string, number>();
  const protoOf = new Map<string, (typeof txRows)[number]>();
  let notesDropped = 0;
  for (const tx of txRows) {
    const accountId = importedAccountOf(tx.acc);
    const date = isoDate(tx.date);
    const amount = money(tx.amount);
    if (!accountId || !date || amount === null) {
      found.warn('transaction_skipped');
      continue;
    }
    const description = oneLine(tx.desc, 500) || '-';
    const key = `${accountId}|${date}|${normalizeText(description)}|${toPlain(dec(amount))}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const id = newId();
    txIdOf.set(tx.id, id);
    protoOf.set(tx.id, tx);
    if (multiLine(tx.note, 2000)) notesDropped += 1;
    transactions.push({
      id,
      accountId,
      date,
      description,
      amount,
      categoryId: categoryOf(tx.cat),
      transfer: tx.transfer ?? false,
      transferLocked: tx.tlock ?? false,
      manualCategory: tx.manualCat ?? false,
      depositInterest: !!tx.depLink,
      hash: transactionHash({ accountId, date, description, amount }, occurrence),
    });
  }
  if (notesDropped > 0) found.warn('transaction_notes_dropped', notesDropped);

  // A pair is kept only when both sides were imported and point at each other.
  const pairs: ImportPlan['pairs'] = [];
  for (const [protoId, tx] of protoOf) {
    if (!tx.pair) continue;
    const mine = txIdOf.get(protoId);
    const theirs = txIdOf.get(tx.pair);
    if (mine && theirs && mine !== theirs && protoOf.get(tx.pair)?.pair === protoId) {
      pairs.push({ id: mine, pairId: theirs });
    } else {
      found.warn('pair_dropped');
    }
  }

  /* -------------------------------------------------------------- assets */
  const assets: ImportPlan['assets'] = [];
  const historyPrices: PriceValues[] = [];
  const currentPrices: PriceValues[] = [];
  const tickers = new Set<string>();
  const importedAssets = new Set<string>();
  for (const [index, asset] of assetRows.entries()) {
    const currency = oneLine(asset.ccy, 3).toUpperCase() || 'EUR';
    if (!CURRENCIES.has(currency)) {
      found.issue(`export.assets.${index}.ccy`, 'unsupported currency');
      continue;
    }
    const rawTicker =
      oneLine(asset.ticker, 60).toUpperCase() || oneLine(asset.symbol, 60).toUpperCase();
    let ticker = rawTicker.replace(/[^A-Z0-9.=^:_-]/g, '-').slice(0, 20);
    if (!/^[A-Z0-9]/.test(ticker)) ticker = `X${ticker}`.slice(0, 20);
    if (ticker !== rawTicker) found.warn('asset_adjusted');
    for (let n = 2; tickers.has(ticker); n += 1) {
      ticker = `${ticker.slice(0, 20 - String(n).length - 1)}-${n}`;
      found.warn('asset_adjusted');
    }
    tickers.add(ticker);
    const typeKey = normalizeText(asset.type).toLowerCase();
    const type = ASSET_TYPES[typeKey] ?? (ENGLISH_ASSET_TYPES.has(typeKey) ? typeKey : 'other');
    const dps = money(asset.dps);
    const months = [
      ...new Set(
        (asset.divMonths ?? [])
          .map((month) => whole(month))
          .filter((month): month is number => month !== null && month >= 1 && month <= 12),
      ),
    ].sort((a, b) => a - b);
    const id = assetIdOf.get(asset.id) ?? newId();
    importedAssets.add(asset.id);
    assets.push({
      id,
      values: {
        ticker,
        symbol: oneLine(asset.symbol, 30).toUpperCase() || null,
        name: oneLine(asset.name, 80) || ticker,
        type,
        currency,
        sector: oneLine(asset.sector, 40) || null,
        region: oneLine(asset.country, 40) || null,
        dps: dps !== null && dec(dps).gt(0) ? dps : null,
        divMonths: months,
      },
    });
    const byDate = new Map<string, string>();
    for (const point of asset.prices ?? []) {
      const date = isoDate(point.d);
      const price = unitPrice(point.p);
      if (!date || price === null || !dec(price).gt(0)) {
        found.warn('price_skipped');
        continue;
      }
      byDate.set(date, price);
    }
    const lastDate = isoDate(asset.priceDate);
    const last = unitPrice(asset.price);
    const current =
      lastDate !== null && last !== null && dec(last).gt(0)
        ? { date: lastDate, price: last }
        : null;
    // The current price wins over a history point of the same day, and is written once.
    if (current) byDate.delete(current.date);
    for (const [date, price] of byDate) historyPrices.push({ assetId: id, date, price });
    if (current) currentPrices.push({ assetId: id, ...current });
  }

  /* --------------------------------------------------------------- plans */
  const plans: ImportPlan['plans'] = [];
  const planIdOf = new Map<string, string>();
  /** The account an investment sits in, and its sub-account, when both exist in the pool. */
  const placement = (protoAccount: Maybe<string>, protoSub: Maybe<string>) => {
    const accountId = importedAccountOf(protoAccount);
    if (protoAccount && (!accountId || !CASH_TYPES.has(accountTypeOf.get(protoAccount) ?? ''))) {
      found.warn('account_reference_dropped');
      return { accountId: null, subAccountId: null };
    }
    const subAccountId =
      accountId && protoAccount && protoSub
        ? (subIdOf.get(`${protoAccount}|${protoSub}`) ?? null)
        : null;
    return { accountId, subAccountId };
  };
  for (const plan of firstOfEach(data.plans, found)) {
    const assetId =
      plan.asset && importedAssets.has(plan.asset) ? assetIdOf.get(plan.asset) : undefined;
    const portfolioId = plan.pf ? portfolioIdOf.get(plan.pf) : undefined;
    const amount = money(plan.amount);
    if (!assetId || !portfolioId || amount === null || !dec(amount).gt(0)) {
      found.warn('plan_skipped');
      continue;
    }
    const day = Math.min(28, Math.max(1, whole(plan.day) ?? 1));
    const id = newId();
    planIdOf.set(plan.id, id);
    plans.push({
      id,
      values: {
        portfolioId,
        assetId,
        ...placement(plan.cash, plan.sub),
        amount,
        day,
        active: plan.active ?? true,
      },
    });
  }

  /* ---------------------------------------------------------- operations */
  const ops: ImportPlan['ops'] = [];
  const planPeriods = new Set<string>();
  const extIds = new Set<string>();
  for (const op of firstOfEach(data.ops, found)) {
    const assetId = op.asset && importedAssets.has(op.asset) ? assetIdOf.get(op.asset) : undefined;
    const portfolioId = op.pf ? portfolioIdOf.get(op.pf) : undefined;
    const date = isoDate(op.date);
    const kind = oneLine(op.type, 12);
    const type = kind === 'div' || kind === 'dividend' ? 'dividend' : kind;
    if (
      !assetId ||
      !portfolioId ||
      !date ||
      (type !== 'buy' && type !== 'sell' && type !== 'dividend')
    ) {
      found.warn('op_skipped');
      continue;
    }
    const where = placement(op.cash, op.sub);
    let planId = op.plan ? (planIdOf.get(op.plan) ?? null) : null;
    let planPeriod: string | null = null;
    if (planId) {
      planPeriod = date.slice(0, 7);
      if (planPeriods.has(`${planId}|${planPeriod}`)) {
        planId = null;
        planPeriod = null;
        found.warn('op_adjusted');
      } else {
        planPeriods.add(`${planId}|${planPeriod}`);
      }
    }
    let extId: string | null = oneLine(op.ext, 120) || null;
    if (extId) {
      const key = `${where.accountId ?? ''}|${extId}`;
      if (where.accountId && extIds.has(key)) {
        extId = null;
        found.warn('op_adjusted');
      } else {
        extIds.add(key);
      }
    }
    const base = {
      id: newId(),
      portfolioId,
      assetId,
      ...where,
      date,
      planId,
      planPeriod,
      extId,
      note: null,
    };
    if (type === 'dividend') {
      const amount = money(op.amount);
      if (amount === null) {
        found.warn('op_skipped');
        continue;
      }
      ops.push({
        ...base,
        type,
        qty: null,
        price: null,
        fee: null,
        amount,
        gross: money(op.gross),
        tax: money(op.tax),
        fromCash: false,
      });
      continue;
    }
    const qty = quantity(op.qty);
    const price = unitPrice(op.price);
    if (qty === null || !dec(qty).gt(0) || price === null || dec(price).isNeg()) {
      found.warn('op_skipped');
      continue;
    }
    let fee = money(op.fee);
    if (fee !== null && dec(fee).isNeg()) {
      fee = null;
      found.warn('op_adjusted');
    }
    ops.push({
      ...base,
      type,
      qty,
      price,
      fee,
      amount: null,
      gross: null,
      tax: null,
      fromCash: type === 'buy' && (op.fromCash ?? false),
    });
  }

  /* ----------------------------------------------- portfolio cash moves */
  const cashMoves: ImportPlan['cashMoves'] = [];
  for (const move of firstOfEach(data.pfMoves, found)) {
    const portfolioId = move.pf ? portfolioIdOf.get(move.pf) : undefined;
    const accountId = importedAccountOf(move.acc);
    const date = isoDate(move.date);
    const amount = money(move.amount);
    if (!portfolioId || !accountId || !date || amount === null || dec(amount).isZero()) {
      found.warn('cash_move_skipped');
      continue;
    }
    const transactionId = move.txId ? (txIdOf.get(move.txId) ?? null) : null;
    cashMoves.push({
      id: newId(),
      values: {
        portfolioId,
        accountId,
        date,
        amount,
        note: multiLine(move.note, 2000) || null,
        transactionId,
        mirror: transactionId !== null,
      },
    });
  }

  /* ------------------------------------------------------------ interest */
  const interest: ImportPlan['interest'] = [];
  for (const entry of firstOfEach(data.interest, found)) {
    const accountId = importedAccountOf(entry.acc);
    const date = isoDate(entry.date);
    const amount = money(entry.amount);
    if (!accountId || !date || amount === null || !dec(amount).gt(0)) {
      found.warn('interest_skipped');
      continue;
    }
    interest.push({
      id: newId(),
      values: { accountId, date, amount, note: multiLine(entry.note, 500) || null },
    });
  }

  /* ------------------------------------------------------------ settings */
  let settings: ImportPlan['settings'] = null;
  if (data.settings) {
    const overrides: Record<string, string> = {};
    for (const [currency, value] of Object.entries(data.settings.fx ?? {})) {
      const rate = value === null || value === undefined ? null : unitPrice(value);
      if (
        !/^[A-Z]{3}$/.test(currency) ||
        currency === 'EUR' ||
        rate === null ||
        !dec(rate).gt(0) ||
        Object.keys(overrides).length >= 20
      ) {
        found.warn('fx_skipped');
        continue;
      }
      overrides[currency] = rate;
    }
    const days = whole(data.settings.tdays);
    settings = {
      transferWindowDays: days === null ? null : Math.min(30, Math.max(0, days)),
      depositTax: percent(data.settings.tax),
      dividendTax: percent(data.settings.divTax),
      fxOverrides: overrides,
    };
  }

  const goals = (data.goals ?? []).length;
  if (goals > 0) found.warn('goals_not_imported', goals);

  if (found.issues.length > 0) {
    throw new ValidationError('The file has data the application cannot store.', found.issues);
  }

  return {
    newHolders,
    portfolios,
    accounts,
    products,
    deposits,
    assets,
    historyPrices,
    currentPrices,
    categories,
    categorySettings,
    rules,
    transactions,
    pairs,
    plans,
    ops,
    cashMoves,
    interest,
    settings,
    counts: {
      holders: newHolders.length,
      holdersMatched,
      accounts: accounts.length,
      subAccounts: accounts.reduce((total, account) => total + account.subAccounts.length, 0),
      savingsProducts: products.length,
      deposits: deposits.length,
      categories: categories.length,
      categorySettings: categorySettings.length,
      rules: rules.length,
      transactions: transactions.length,
      transferPairs: pairs.length / 2,
      assets: assets.length,
      assetPrices: historyPrices.length + currentPrices.length,
      portfolios: portfolios.length,
      plans: plans.length,
      investmentOps: ops.length,
      cashMoves: cashMoves.length,
      interestEntries: interest.length,
      goalsSkipped: goals,
    },
    warnings: [...found.warnings].map(([code, count]) => ({ code, count })),
  };
}
