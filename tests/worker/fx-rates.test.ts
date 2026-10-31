import { describe, expect, it, vi } from 'vitest';

import { createEcbFxProvider, parseEcbRates } from '../../apps/worker/src/fx-rates/ecb';

// A recorded ECB answer (eurofxref-daily.xml shape): units of currency per one euro.
const DAILY = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time='2026-10-30'>
      <Cube currency='USD' rate='1.1620'/>
      <Cube currency='JPY' rate='175.43'/>
      <Cube currency='GBP' rate='0.86915'/>
      <Cube currency='CHF' rate='0.9301'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const HISTORY = DAILY.replace(
  "<Cube time='2026-10-30'>",
  `<Cube time='2026-10-29'>
      <Cube currency='USD' rate='1.1600'/>
      <Cube currency='GBP' rate='0.8700'/>
      <Cube currency='CHF' rate='0.9300'/>
    </Cube>
    <Cube time='2026-10-30'>`,
);

describe('parseEcbRates', () => {
  it('keeps USD, GBP and CHF and inverts them to EUR per unit with 8 decimals', () => {
    expect(parseEcbRates(DAILY).points).toEqual([
      { ccy: 'CHF', date: '2026-10-30', eurRate: '1.07515321' },
      { ccy: 'GBP', date: '2026-10-30', eurRate: '1.15054939' },
      { ccy: 'USD', date: '2026-10-30', eurRate: '0.86058520' },
    ]);
  });

  it('inverts correctly to 6 decimals', () => {
    const usd = parseEcbRates(DAILY).points.find((point) => point.ccy === 'USD');
    expect(usd?.eurRate.slice(0, 8)).toBe('0.860585');
  });

  it('reads several days, oldest first', () => {
    const { points } = parseEcbRates(HISTORY);
    expect(points).toHaveLength(6);
    expect(points[0]?.date).toBe('2026-10-29');
    expect(points[5]?.date).toBe('2026-10-30');
  });

  it('refuses an external entity (XXE)', () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
${DAILY.replace(/^<\?xml[^>]*>\s*/, '').replace('<gesmes:subject>Reference rates', '<gesmes:subject>&xxe;')}`;
    expect(() => parseEcbRates(xxe)).toThrow('declares entities');
  });

  it('refuses a billion-laughs style entity reference even without a DOCTYPE', () => {
    expect(() => parseEcbRates(DAILY.replace('Reference rates', '&lol9;'))).toThrow();
  });

  it('refuses shapes it does not know', () => {
    expect(() => parseEcbRates('<html></html>')).toThrow();
    expect(() => parseEcbRates(DAILY.replace("rate='1.1620'", "rate='abc'"))).toThrow();
    expect(() => parseEcbRates(DAILY.replace("rate='1.1620'", "rate='0'"))).toThrow();
    expect(() => parseEcbRates(DAILY.replace("time='2026-10-30'", "time='nope'"))).toThrow();
    expect(() => parseEcbRates(DAILY.replace("time='2026-10-30'", "time='2026-02-31'"))).toThrow(
      'invalid date',
    );
  });

  it('ignores a bad rate in a currency it does not store', () => {
    const bad = DAILY.replace("rate='175.43'", "rate='not-a-number'");
    expect(parseEcbRates(bad).points).toHaveLength(3);
  });

  it('skips a day that lacks one of the currencies and keeps the others', () => {
    const lacking = HISTORY.replace("<Cube currency='CHF' rate='0.9300'/>", '');
    const batch = parseEcbRates(lacking);
    expect(batch.skippedDays).toBe(1);
    expect(batch.points.map((point) => point.date)).toEqual([
      '2026-10-30',
      '2026-10-30',
      '2026-10-30',
    ]);
    expect(() => parseEcbRates(DAILY.replace("<Cube currency='CHF' rate='0.9301'/>", ''))).toThrow(
      'no complete day',
    );
  });
});

describe('createEcbFxProvider', () => {
  const answer = (body: string, init?: ResponseInit) =>
    vi.fn(() => Promise.resolve(new Response(body, init)));

  it('reads the fixed 90-day URL and refuses redirects', async () => {
    const fetchImpl = answer(HISTORY);
    await createEcbFxProvider(fetchImpl).recent();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { redirect: string }];
    expect(url).toBe('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml');
    expect(init.redirect).toBe('error');
  });

  it('puts only the status in the error, never the body', async () => {
    const provider = createEcbFxProvider(answer('secret body', { status: 503 }));
    await expect(provider.recent()).rejects.toThrow(/^the ECB answered 503$/);
  });

  it('refuses an answer that declares it is too large', async () => {
    const provider = createEcbFxProvider(answer('x', { headers: { 'content-length': '5000000' } }));
    await expect(provider.recent()).rejects.toThrow('too large');
  });

  it('aborts a body that streams past the cap without declaring it', async () => {
    const chunk = new Uint8Array(400_000);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const provider = createEcbFxProvider(() => Promise.resolve(new Response(body)));
    await expect(provider.recent()).rejects.toThrow('too large');
    expect(sent).toBeLessThan(6);
  });
});
