import type { AccountCard } from '@webapp/lib/accounts-types';
import type { ImportNeedsMapping, ImportPreview } from '@webapp/lib/imports-types';

// Pure helpers of the import screen: which accounts fit a file, which one the file names, what the
// confirm button says and the bodies sent to the API. Nothing here reads the DOM or the network.

export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xlsm', '.pdf'] as const;
/** The server refuses more (413); checking first spares the upload. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type Confidence = 'high' | 'medium' | 'low';

/** How sure the parser is, in the words of the banner (“confiança alta”). */
export function confidenceLevel(confidence: number): Confidence {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** A bank file goes to a cash account, a broker file to a brokerage account. */
export function eligibleAccounts(
  accounts: readonly AccountCard[],
  kind: 'bank' | 'broker',
): AccountCard[] {
  return accounts.filter((account) => (account.type === 'brokerage') === (kind === 'broker'));
}

const squash = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * The account a file names by its account number (IBAN or broker account number), or `null` when
 * none or several fit. Only a full match counts, so a short hint never picks the wrong account.
 */
export function matchAccountByHint(
  hint: string | null,
  accounts: readonly AccountCard[],
): AccountCard | null {
  const wanted = hint ? squash(hint) : '';
  if (wanted.length < 4) return null;
  const found = accounts.filter(
    (account) =>
      (!!account.iban && squash(account.iban) === wanted) ||
      (!!account.xtbAccountNo && squash(account.xtbAccountNo) === wanted),
  );
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The account to start with: the one the file names, else the only one that fits. */
export function defaultAccount(
  preview: Pick<ImportPreview, 'accountHint' | 'accountId' | 'kind'>,
  accounts: readonly AccountCard[],
): string {
  if (preview.accountId) return preview.accountId;
  const fitting = eligibleAccounts(accounts, preview.kind);
  const named = matchAccountByHint(preview.accountHint, fitting);
  if (named) return named.id;
  return fitting.length === 1 ? (fitting[0]?.id ?? '') : '';
}

/** The multipart body of `POST /imports`; `parserId` and `spec` are never sent together. */
export function uploadForm(
  file: File,
  options: { accountId?: string; parserId?: string; spec?: unknown } = {},
): FormData {
  const form = new FormData();
  form.set('file', file);
  if (options.accountId) form.set('accountId', options.accountId);
  if (options.parserId) form.set('parserId', options.parserId);
  else if (options.spec !== undefined) form.set('spec', JSON.stringify(options.spec));
  return form;
}

export type AssetKind = 'stock' | 'etf';

export interface NewAssetBody {
  symbol: string;
  ticker: string;
  name: string;
  type: AssetKind;
  currency: string;
}

const ASSET_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

/** The symbols of a broker file the pool has no asset for yet, as assets to create with the commit. */
export function newAssetsFor(
  preview: Pick<ImportPreview, 'broker' | 'rows'>,
  types: Readonly<Record<string, AssetKind>> = {},
): NewAssetBody[] {
  const missing = preview.broker?.symbols.filter((symbol) => symbol.assetId === null) ?? [];
  return missing.map(({ symbol, name }) => {
    const row = preview.rows.find((one) => one.kind === 'broker' && one.symbol === symbol);
    const currency = row?.kind === 'broker' ? row.currency.toUpperCase() : 'EUR';
    return {
      symbol,
      // Tickers are stored without the exchange suffix of the broker (`AAPL.US` -> `AAPL`).
      ticker: symbol.replace(/\.[A-Za-z]{1,3}$/, ''),
      name: name ?? symbol,
      type: types[symbol] ?? 'stock',
      currency: ASSET_CURRENCIES.includes(currency) ? currency : 'EUR',
    };
  });
}

export interface CommitChoices {
  accountId: string;
  adjustOpeningBalance: boolean;
  portfolioId: string;
  assetTypes: Readonly<Record<string, AssetKind>>;
  /** Holder -> sub-account chosen by hand (`''` leaves the lines without one). */
  subAccounts: Readonly<Record<string, string>>;
}

/** The body of `POST /imports/:id/commit`: only fields the user chose; the pool is in the URL. */
export function commitBody(preview: ImportPreview, choices: CommitChoices) {
  if (preview.kind === 'bank') {
    return { accountId: choices.accountId, adjustOpeningBalance: choices.adjustOpeningBalance };
  }
  return {
    accountId: choices.accountId,
    ...(choices.portfolioId ? { portfolioId: choices.portfolioId } : {}),
    newAssets: newAssetsFor(preview, choices.assetTypes),
    subAccounts: Object.fromEntries(
      Object.entries(choices.subAccounts).map(([holder, id]) => [holder, id === '' ? null : id]),
    ),
  };
}

/** Lines the commit would write; the confirm button is off at 0 (a file already imported). */
export function newCount(preview: ImportPreview): number {
  return preview.accountId ? preview.summary.new : 0;
}

/** The first and last date of the lines, `yyyy-mm-dd`, or `null` without lines. */
export function periodOf(preview: Pick<ImportPreview, 'rows'>): [string, string] | null {
  const dates = preview.rows.map((row) => row.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first && last ? [first, last] : null;
}

export type MappingColumn = 'date' | 'description' | 'amount' | 'balance';
export const MAPPING_COLUMNS: readonly MappingColumn[] = [
  'date',
  'description',
  'amount',
  'balance',
];
export const DATE_FORMATS = [
  'dd-mm-yyyy',
  'dd/mm/yyyy',
  'dd.mm.yyyy',
  'yyyy-mm-dd',
  'yyyy/mm/dd',
  'mm/dd/yyyy',
  'dd-mm-yy',
  'dd/mm/yy',
] as const;

type Spec = ImportNeedsMapping['spec'];
const section = (spec: Spec, name: string): Record<string, unknown> => {
  const value = spec[name];
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
};

export function columnOf(spec: Spec, column: MappingColumn): string {
  const value = section(spec, 'columns')[column];
  return typeof value === 'string' ? value : '';
}

export function dateFormatOf(spec: Spec): string {
  const value = section(spec, 'formats')['date'];
  return typeof value === 'string' ? value : '';
}

/** The mapping with one column pointed at another header (`''` clears an optional one). */
export function withColumn(spec: Spec, column: MappingColumn, header: string): Spec {
  // A single amount column replaces the debit/credit pair.
  const dropped = column === 'amount' && header !== '' ? ['debit', 'credit'] : [];
  const kept = Object.entries(section(spec, 'columns')).filter(
    ([key]) => key !== column && !dropped.includes(key),
  );
  const columns = Object.fromEntries(header === '' ? kept : [...kept, [column, header]]);
  return { ...spec, columns };
}

export function withDateFormat(spec: Spec, format: string): Spec {
  return { ...spec, formats: { ...section(spec, 'formats'), date: format } };
}
