import type { ReadableStream as WebStream } from 'node:stream/web';

import Decimal from 'decimal.js';
import { z } from 'zod';

/** The currencies the job stores: the ones a family account or portfolio can be held in. */
export const FX_CURRENCIES = ['USD', 'GBP', 'CHF'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export interface FxRatePoint {
  ccy: FxCurrency;
  /** `yyyy-mm-dd`, the day the ECB published the rate. */
  date: string;
  /** EUR per one unit of `ccy`: the inverse of the ECB's units per EUR, 8 decimals. */
  eurRate: string;
}

/** One source of daily rates. Another source is another class with these methods. */
export interface FxRateProvider {
  readonly id: 'ecb';
  /**
   * The rates of the last ~90 days. Always the whole window: the job is idempotent, so a missed run
   * or a revised rate is recovered by the next one.
   */
  recent(): Promise<FxRateBatch>;
}

// The ECB's euro foreign exchange reference rates. Hosts and paths are fixed, nothing from outside
// reaches a URL.
const ECB_BASE = 'https://www.ecb.europa.eu/stats/eurofxref';
const HISTORY_URL = `${ECB_BASE}/eurofxref-hist-90d.xml`;

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 15_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Units = z.string().regex(/^\d{1,6}(\.\d{1,8})?$/);

export type Fetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; redirect: 'error' },
) => Promise<Response>;

const ATTRIBUTES = /([A-Za-z]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;

function attributesOf(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTES)) {
    const [, name, single, double] = match;
    if (name) found[name] = single ?? double ?? '';
  }
  return found;
}

/** True when the document declares a DTD or an entity, or uses an entity other than the five built-in ones. */
function declaresEntities(xml: string): boolean {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml)) return true;
  return /&(?!(?:amp|lt|gt|quot|apos);)/.test(xml);
}

/** What one document gave: the complete days, and how many days were left out for lacking a currency. */
export interface FxRateBatch {
  points: FxRatePoint[];
  skippedDays: number;
}

const isRealDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Parses an ECB `eurofxref` document into rates (EUR per unit, inverted to 8 decimals). The document
 * is a flat list of `<Cube time='...'>` with `<Cube currency='...' rate='...'/>` inside, so it is
 * read with a strict scanner, not an XML parser: a DOCTYPE or ENTITY declaration (and any entity
 * reference) is refused outright, so there is no external entity and no entity expansion. Only the
 * currencies the job stores are validated; a day lacking one of them is skipped, not fatal.
 */
export function parseEcbRates(xml: string): FxRateBatch {
  if (declaresEntities(xml)) throw new Error('the ECB document declares entities');
  if (!/<gesmes:Envelope[\s>]/.test(xml)) throw new Error('not an ECB reference rates document');
  const days = new Map<string, FxRatePoint[]>();
  let date: string | undefined;
  for (const match of xml.matchAll(/<Cube\b([^>]*?)\/?>/g)) {
    const attrs = attributesOf(match[1] ?? '');
    const time = attrs['time'];
    const currency = attrs['currency'];
    if (time !== undefined) {
      if (!DATE.test(time) || !isRealDate(time)) throw new Error('a Cube has an invalid date');
      date = time;
      if (!days.has(date)) days.set(date, []);
    } else if (currency !== undefined) {
      if (!date) throw new Error('a rate comes before any date');
      const ccy = FX_CURRENCIES.find((known) => known === currency);
      if (!ccy) continue;
      const units = new Decimal(Units.parse(attrs['rate']));
      if (units.lte(0)) throw new Error('a rate is not positive');
      days.get(date)?.push({ ccy, date, eurRate: new Decimal(1).div(units).toFixed(8) });
    }
  }
  if (days.size === 0) throw new Error('the ECB document has no date');
  const points: FxRatePoint[] = [];
  let skippedDays = 0;
  for (const dayPoints of days.values()) {
    if (new Set(dayPoints.map((point) => point.ccy)).size === FX_CURRENCIES.length) {
      points.push(...dayPoints);
    } else {
      skippedDays += 1;
    }
  }
  if (points.length === 0) throw new Error('the ECB document has no complete day');
  points.sort((a, b) => a.date.localeCompare(b.date) || a.ccy.localeCompare(b.ccy));
  return { points, skippedDays };
}

/** Reads the body up to `MAX_BYTES`, counting as it streams, and aborts past the limit. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error('the ECB answer is too large');
  if (!response.body) throw new Error('the ECB answer has no body');
  const reader = (response.body as unknown as WebStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('the ECB answer is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function download(fetchImpl: Fetch, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'text/xml, application/xml' },
    // A redirect would leave the fixed host: refuse it.
    redirect: 'error',
  });
  // Never put the body in the error: only the status says what went wrong.
  if (!response.ok) throw new Error(`the ECB answered ${response.status}`);
  return readCapped(response);
}

/** The ECB adapter. `fetchImpl` is the network; tests give it recorded answers. */
export function createEcbFxProvider(fetchImpl: Fetch = fetch): FxRateProvider {
  return {
    id: 'ecb',
    async recent() {
      return parseEcbRates(await download(fetchImpl, HISTORY_URL));
    },
  };
}
