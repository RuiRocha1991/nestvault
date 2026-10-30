import { z } from 'zod';

/** The reference rates of the loans: what the job stores and the loans read. */
export const INDEX_RATE_INDEXES = ['euribor_3m', 'euribor_6m', 'euribor_12m'] as const;
export type IndexRateIndex = (typeof INDEX_RATE_INDEXES)[number];

export interface IndexRatePoint {
  rateIndex: IndexRateIndex;
  /** First day of the month, `yyyy-mm-dd`. */
  period: string;
  /** Percent, a decimal string with 6 places. */
  rate: string;
}

/** One source of monthly index values. Another source is another class with this method. */
export interface IndexRateProvider {
  readonly id: 'ecb';
  /** The monthly values of an index from `fromPeriod` (`yyyy-mm`) on. */
  monthly(rateIndex: IndexRateIndex, fromPeriod: string): Promise<IndexRatePoint[]>;
}

// ECB Data Portal, dataset FM (financial market data): monthly average of the Euribor, in percent.
// The host and the path are fixed; only the series (from an allow-list) and the start month vary.
const ECB_URL = 'https://data-api.ecb.europa.eu/service/data/FM';
const SERIES: Record<IndexRateIndex, string> = {
  euribor_3m: 'EURIBOR3MD_',
  euribor_6m: 'EURIBOR6MD_',
  euribor_12m: 'EURIBOR1YD_',
};

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 15_000;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// SDMX-JSON as the ECB sends it: one series, its observations keyed by the position of the month in
// the list of periods. Anything that does not look like this is refused, never guessed at.
const ResponseSchema = z.object({
  dataSets: z
    .array(
      z.object({
        series: z.record(
          z.string(),
          z.object({
            observations: z.record(z.string(), z.array(z.number().nullable()).min(1)),
          }),
        ),
      }),
    )
    .length(1),
  structure: z.object({
    dimensions: z.object({
      observation: z
        .array(z.object({ values: z.array(z.object({ id: z.string().regex(PERIOD) })) }))
        .length(1),
    }),
  }),
});

export type Fetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

/** Parses an ECB answer into points; throws when the shape or a value is not what the table accepts. */
export function parseEcbResponse(rateIndex: IndexRateIndex, body: unknown): IndexRatePoint[] {
  const parsed = ResponseSchema.parse(body);
  const series = Object.values(parsed.dataSets[0]?.series ?? {});
  if (series.length !== 1) throw new Error('expected exactly one series');
  const periods = parsed.structure.dimensions.observation[0]?.values ?? [];
  const points: IndexRatePoint[] = [];
  for (const [position, values] of Object.entries(series[0]?.observations ?? {})) {
    const period = periods[Number(position)]?.id;
    const value = values[0];
    if (!period) throw new Error('an observation points outside the periods');
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || value < -10 || value > 100) {
      throw new Error('an index value is out of range');
    }
    points.push({ rateIndex, period: `${period}-01`, rate: value.toFixed(6) });
  }
  return points.sort((a, b) => a.period.localeCompare(b.period));
}

/** The ECB adapter. `fetchImpl` is the network; tests give it recorded answers. */
export function createEcbProvider(fetchImpl: Fetch = fetch): IndexRateProvider {
  return {
    id: 'ecb',
    async monthly(rateIndex, fromPeriod) {
      if (!PERIOD.test(fromPeriod)) throw new RangeError('fromPeriod is yyyy-mm');
      const url = `${ECB_URL}/M.U2.EUR.RT.MM.${SERIES[rateIndex]}.HSTA?startPeriod=${fromPeriod}&format=jsondata`;
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      // Never put the body in the error: only the status says what went wrong.
      if (!response.ok) throw new Error(`the ECB answered ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) throw new Error('the ECB answer is too large');
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('the ECB answer is too large');
      return parseEcbResponse(rateIndex, JSON.parse(text));
    },
  };
}
