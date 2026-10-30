import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createEcbProvider,
  parseEcbResponse,
  type Fetch,
} from '../../apps/worker/src/index-rates/ecb';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/ecb', `${name}.json`), 'utf8'));

// Recorded answers of the ECB Data Portal (monthly averages, Aug to Oct 2021): no network in tests.
describe('ECB answer', () => {
  it('turns the recorded 6-month series into one point per month, values in percent', () => {
    expect(parseEcbResponse('euribor_6m', fixture('euribor_6m'))).toEqual([
      { rateIndex: 'euribor_6m', period: '2021-08-01', rate: '-0.527364' },
      { rateIndex: 'euribor_6m', period: '2021-09-01', rate: '-0.522409' },
      { rateIndex: 'euribor_6m', period: '2021-10-01', rate: '-0.527238' },
    ]);
  });

  it('reads the 3 and 12 month series too', () => {
    expect(parseEcbResponse('euribor_3m', fixture('euribor_3m'))[0]?.rate).toBe('-0.547591');
    expect(parseEcbResponse('euribor_12m', fixture('euribor_12m'))[2]?.rate).toBe('-0.476762');
  });

  it('skips a month without a value', () => {
    const body = structuredClone(fixture('euribor_6m')) as {
      dataSets: { series: Record<string, { observations: Record<string, (number | null)[]> }> }[];
    };
    const series = Object.values(body.dataSets[0]?.series ?? {})[0];
    if (series) series.observations['1'] = [null, 0, 0];
    expect(parseEcbResponse('euribor_6m', body).map((point) => point.period)).toEqual([
      '2021-08-01',
      '2021-10-01',
    ]);
  });

  it.each([
    ['not an object', 'rumour'],
    ['no data sets', { dataSets: [], structure: { dimensions: { observation: [] } } }],
    [
      'a period that is not a month',
      {
        dataSets: [{ series: { s: { observations: { '0': [1] } } } }],
        structure: { dimensions: { observation: [{ values: [{ id: '2021-08-15' }] }] } },
      },
    ],
    [
      'a value out of range',
      {
        dataSets: [{ series: { s: { observations: { '0': [250] } } } }],
        structure: { dimensions: { observation: [{ values: [{ id: '2021-08' }] }] } },
      },
    ],
    [
      'an observation outside the periods',
      {
        dataSets: [{ series: { s: { observations: { '5': [1] } } } }],
        structure: { dimensions: { observation: [{ values: [{ id: '2021-08' }] }] } },
      },
    ],
    [
      'two series',
      {
        dataSets: [{ series: { a: { observations: {} }, b: { observations: {} } } }],
        structure: { dimensions: { observation: [{ values: [] }] } },
      },
    ],
  ])('refuses %s', (_name, body) => {
    expect(() => parseEcbResponse('euribor_6m', body)).toThrow();
  });
});

describe('ECB provider', () => {
  const answering = (body: unknown, init: ResponseInit = {}): Fetch =>
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), init)));

  it('asks the fixed ECB host for the series of the index, from the month given', async () => {
    const fetchImpl = answering(fixture('euribor_3m'));
    const points = await createEcbProvider(fetchImpl).monthly('euribor_3m', '2021-08');
    expect(points).toHaveLength(3);
    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(
      'https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA?startPeriod=2021-08&format=jsondata',
    );
  });

  it('refuses a start month that is not yyyy-mm, so nothing else reaches the URL', async () => {
    const fetchImpl = answering(fixture('euribor_3m'));
    await expect(
      createEcbProvider(fetchImpl).monthly('euribor_3m', '2021-08&format=csv#'),
    ).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on an error status without putting the body in the error', async () => {
    const fetchImpl = answering({ secret: 'do-not-leak' }, { status: 503 });
    const error = await createEcbProvider(fetchImpl)
      .monthly('euribor_6m', '2021-08')
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('the ECB answered 503');
    expect((error as Error).message).not.toContain('do-not-leak');
  });

  it('refuses an answer that is too large', async () => {
    const big = new Response('x'.repeat(1_000_001));
    await expect(
      createEcbProvider(() => Promise.resolve(big)).monthly('euribor_6m', '2021-08'),
    ).rejects.toThrow('too large');
  });

  it('refuses an answer that is not JSON', async () => {
    await expect(
      createEcbProvider(() => Promise.resolve(new Response('<html>'))).monthly(
        'euribor_6m',
        '2021-08',
      ),
    ).rejects.toThrow();
  });
});
