import type { AssetPriceRow, AssetRow } from '@nestvault/db';
import { dec, toPlain } from '@nestvault/domain';
import { z } from 'zod';

export const ASSET_TYPES = [
  'stock',
  'etf',
  'fund',
  'reit',
  'ppr',
  'bond',
  'crypto',
  'other',
] as const;
export const ASSET_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;
export const BULK_PRICES_MAX = 500;
export const PRICE_HISTORY_MAX = 5000;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Text = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);

/** Upper case, no spaces: how tickers are stored and compared (`VWCE.DE`, `BTC-USD`, `^GSPC`). */
const Ticker = z
  .string()
  .trim()
  .max(20)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9.=^:_-]{0,19}$/));

/** A unit price: positive decimal string, up to 6 decimals (the column is numeric(18,6)). */
const PRICE = /^\d{1,12}(\.\d{1,6})?$/;
const Price = z.string().refine((value) => PRICE.test(value) && dec(value).gt(0));
/** The annual dividend per share: zero or more, up to 4 decimals. */
const DPS = /^\d{1,14}(\.\d{1,4})?$/;
const Dps = z.string().refine((value) => DPS.test(value));

const DivMonths = z
  .array(z.number().int().min(1).max(12))
  .max(12)
  .transform((months) => [...new Set(months)].sort((a, b) => a - b));

const AssetFields = {
  ticker: Ticker,
  symbol: Text(30).nullable(),
  name: Text(80),
  type: z.enum(ASSET_TYPES),
  currency: z.enum(ASSET_CURRENCIES),
  sector: Text(40).nullable(),
  region: Text(40).nullable(),
  dps: Dps.nullable(),
  divMonths: DivMonths,
};

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreateAssetInput = z
  .object({
    ticker: AssetFields.ticker,
    name: AssetFields.name,
    type: AssetFields.type,
    currency: AssetFields.currency,
    symbol: AssetFields.symbol.optional(),
    sector: AssetFields.sector.optional(),
    region: AssetFields.region.optional(),
    dps: AssetFields.dps.optional(),
    divMonths: AssetFields.divMonths.optional(),
  })
  .strict();
export type CreateAssetInput = z.input<typeof CreateAssetInput>;

/** Fields left out stay as they are. */
export const UpdateAssetInput = z
  .object({
    ticker: AssetFields.ticker,
    name: AssetFields.name,
    type: AssetFields.type,
    currency: AssetFields.currency,
    symbol: AssetFields.symbol,
    sector: AssetFields.sector,
    region: AssetFields.region,
    dps: AssetFields.dps,
    divMonths: AssetFields.divMonths,
  })
  .partial()
  .strict();
export type UpdateAssetInput = z.input<typeof UpdateAssetInput>;

/** `?asOf=yyyy-mm-dd` (today when left out). */
export const AssetsQuery = z.object({ asOf: z.iso.date().optional() }).strict();
export type AssetsQuery = z.input<typeof AssetsQuery>;

export const PriceInput = z.object({ date: z.iso.date(), price: Price }).strict();
export type PriceInput = z.input<typeof PriceInput>;

export const BulkPricesInput = z
  .object({
    prices: z
      .array(z.object({ ticker: Ticker, date: z.iso.date(), price: Price }).strict())
      .min(1)
      .max(BULK_PRICES_MAX),
  })
  .strict();
export type BulkPricesInput = z.input<typeof BulkPricesInput>;

export const PriceHistoryQuery = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z.coerce.number().int().min(1).max(PRICE_HISTORY_MAX).optional(),
  })
  .strict();
export type PriceHistoryQuery = z.input<typeof PriceHistoryQuery>;

export const AssetDto = z.object({
  id: z.uuid(),
  ticker: z.string(),
  symbol: z.string().nullable(),
  name: z.string(),
  type: z.enum(ASSET_TYPES),
  currency: z.string(),
  sector: z.string().nullable(),
  region: z.string().nullable(),
  dps: z.string().nullable(),
  divMonths: z.array(z.number().int()),
  /** The newest price dated on or before the day asked (today by default), or null without one. */
  price: z.string().nullable(),
  priceDate: z.iso.date().nullable(),
});
export type AssetDto = z.infer<typeof AssetDto>;

export const AssetListDto = z.object({ assets: z.array(AssetDto) });
export type AssetListDto = z.infer<typeof AssetListDto>;

export const PriceDto = z.object({
  date: z.iso.date(),
  price: z.string(),
  source: z.enum(['manual', 'bulk', 'provider']),
});
export type PriceDto = z.infer<typeof PriceDto>;

export const PriceHistoryDto = z.object({ prices: z.array(PriceDto) });
export type PriceHistoryDto = z.infer<typeof PriceHistoryDto>;

export const BulkPricesDto = z.object({ updated: z.number().int() });
export type BulkPricesDto = z.infer<typeof BulkPricesDto>;

export const toPriceDto = (row: AssetPriceRow): PriceDto => ({
  date: row.date,
  price: toPlain(row.price),
  source: row.source as PriceDto['source'],
});

export const toAssetDto = (row: AssetRow, latest: AssetPriceRow | undefined): AssetDto => ({
  id: row.id,
  ticker: row.ticker,
  symbol: row.symbol,
  name: row.name,
  type: row.type as AssetDto['type'],
  currency: row.currency,
  sector: row.sector,
  region: row.region,
  dps: row.dps === null ? null : toPlain(row.dps),
  divMonths: row.divMonths,
  price: latest ? toPlain(latest.price) : null,
  priceDate: latest ? latest.date : null,
});
