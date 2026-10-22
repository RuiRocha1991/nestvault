import { seriesColor } from '@nestvault/ui';

import { badgeText } from '@webapp/lib/portfolios-view';

/** A stable colour per ticker, so an asset looks the same on every tab. */
export function tickerColor(ticker: string): string {
  let hash = 0;
  for (const char of ticker) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return seriesColor(hash);
}

/** The prototype's colour of each asset type. */
const TYPE_COLORS: Readonly<Record<string, string>> = {
  stock: '#F2913D',
  etf: '#9D6BFF',
  fund: '#5B8DEF',
  reit: '#E5424D',
  ppr: '#2BC6B4',
  bond: '#C9A227',
  crypto: '#E356A8',
  other: '#8C8FB8',
};

/** The coloured square with the ticker the prototype shows next to every asset (colour by type). */
export function AssetBadge({ ticker, type }: { ticker: string; type?: string | undefined }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-[9px] font-bold leading-none text-white"
      style={{ background: (type && TYPE_COLORS[type]) || tickerColor(ticker) }}
    >
      {badgeText(ticker)}
    </span>
  );
}

/** Badge, ticker and name of an asset: the first cell of the positions and transactions tables. */
export function AssetCell({
  ticker,
  name,
  type,
  compact = false,
}: {
  ticker: string;
  name?: string | undefined;
  type?: string | undefined;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AssetBadge ticker={ticker} type={type} />
      <div className="flex min-w-0 flex-col">
        <b className="font-semibold">{ticker}</b>
        {!compact && !!name && (
          <span className="max-w-[260px] truncate text-sm text-fg-3">{name}</span>
        )}
      </div>
    </div>
  );
}
