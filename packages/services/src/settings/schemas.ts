import type { PoolSettingsRow } from '@nestvault/db';
import { dec, type ResolvedFxRate } from '@nestvault/domain';
import { z } from 'zod';

export const TRANSFER_WINDOW_MAX_DAYS = 30;
export const FX_OVERRIDES_MAX = 20;

/** The values of a pool that never saved its settings (PRD 04, the prototype's defaults). */
export const DEFAULT_SETTINGS = {
  transferWindowDays: 3,
  depositTax: '28',
  dividendTax: '28',
  displayCurrency: 'EUR',
  fxOverrides: {},
} as const;

/** A percentage between 0 and 100 with up to 4 decimals, as a decimal string (never a float). */
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const Percent = z.string().refine((value) => PERCENT.test(value) && dec(value).lte(100));

/** EUR per unit: positive, at most 8 decimals, below a million (a rate, not an amount). */
const RATE = /^\d{1,6}(\.\d{1,8})?$/;
const Rate = z.string().refine((value) => RATE.test(value) && dec(value).gt(0));

const Currency = z.string().regex(/^[A-Z]{3}$/);
/** EUR is the unit of every total: it has no rate of its own. */
const ForeignCurrency = Currency.refine((value) => value !== 'EUR');

/**
 * Only client-editable fields (`.strict()`); fields left out stay as they are. `fxOverrides`
 * replaces the whole map (`{}` removes every override).
 */
export const UpdateSettingsInput = z
  .object({
    transferWindowDays: z.number().int().min(0).max(TRANSFER_WINDOW_MAX_DAYS),
    depositTax: Percent,
    dividendTax: Percent,
    displayCurrency: Currency,
    fxOverrides: z
      .record(ForeignCurrency, Rate)
      .refine((map) => Object.keys(map).length <= FX_OVERRIDES_MAX),
  })
  .partial()
  .strict();
export type UpdateSettingsInput = z.input<typeof UpdateSettingsInput>;

export const SettingsDto = z.object({
  transferWindowDays: z.number().int(),
  depositTax: z.string(),
  dividendTax: z.string(),
  displayCurrency: z.string(),
  fxOverrides: z.record(z.string(), z.string()),
});
export type SettingsDto = z.infer<typeof SettingsDto>;

/** Percentages come back from numeric(9,6) as "28.000000": shown as "28". */
const plain = (value: string) => dec(value).toString();

export const toSettingsDto = (row: PoolSettingsRow | undefined): SettingsDto =>
  row
    ? {
        transferWindowDays: row.transferWindowDays,
        depositTax: plain(row.depositTax),
        dividendTax: plain(row.dividendTax),
        displayCurrency: row.displayCurrency,
        fxOverrides: Object.fromEntries(
          Object.entries(row.fxOverrides).map(([ccy, rate]) => [ccy, plain(rate)]),
        ),
      }
    : { ...DEFAULT_SETTINGS, fxOverrides: {} };

/** `?asOf=yyyy-mm-dd` (today when left out). */
export const FxQuery = z.object({ asOf: z.iso.date().optional() }).strict();
export type FxQuery = z.input<typeof FxQuery>;

export const FxRateDto = z.object({
  currency: z.string(),
  rate: z.string(),
  marketRate: z.string(),
  source: z.enum(['pool', 'seed', 'ecb', 'manual', 'default']),
  date: z.iso.date().nullable(),
});

export const FxDto = z.object({ asOf: z.iso.date(), rates: z.array(FxRateDto) });
export type FxDto = z.infer<typeof FxDto>;

export const toFxDto = (asOf: string, rates: readonly ResolvedFxRate[]): FxDto => ({
  asOf,
  rates: rates.map((entry) => ({ ...entry })),
});
