export const SEARCH_MAX_LENGTH = 100;
/** Transactions shown on the results page (the newest first). */
export const SEARCH_TRANSACTIONS = 50;

// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The `?q=` of the search page: trimmed, 1-100 characters, no control characters; else `null`. */
export function parseSearchQuery(value: string | string[] | undefined): string | null {
  const first = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!first || first.length > SEARCH_MAX_LENGTH || CONTROL.test(first)) return null;
  return first;
}

interface SearchableAsset {
  ticker: string;
  symbol: string | null;
  name: string;
}

/** Assets whose ticker, symbol or name contains the text (case-insensitive, literal). */
export function matchAssets<T extends SearchableAsset>(assets: readonly T[], query: string): T[] {
  const needle = query.toLocaleLowerCase('pt-PT');
  return assets.filter((asset) =>
    [asset.ticker, asset.symbol ?? '', asset.name].some((field) =>
      field.toLocaleLowerCase('pt-PT').includes(needle),
    ),
  );
}
