import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BarChart,
  ChartLegend,
  Donut,
  LineChart,
  Sparkline,
  compactNumber,
  linearPath,
  niceTicks,
  smoothPath,
} from '@nestvault/ui';

describe('niceTicks', () => {
  it('returns round ticks that cover the range', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(3, 97, 4)).toEqual([0, 25, 50, 75, 100]);
  });

  it('handles a flat range', () => {
    const ticks = niceTicks(5, 5, 4);
    expect(ticks[0]).toBeLessThanOrEqual(5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(6);
  });

  it('covers negative ranges', () => {
    const ticks = niceTicks(-120, 80, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-120);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(80);
    expect(ticks).toContain(0);
  });

  it('scales to large magnitudes without float noise', () => {
    expect(niceTicks(0, 1_000_000, 4)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000]);
  });
});

describe('paths', () => {
  it('smoothPath is empty without points and a lone move with one point', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([[10, 20]])).toBe('M10.0,20.0');
  });

  it('smoothPath emits one cubic segment per interval', () => {
    const d = smoothPath([
      [0, 10],
      [10, 0],
      [20, 10],
    ]);
    expect(d.startsWith('M0.0,10.0')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });

  it('smoothPath control points never leave the vertical range of their segment', () => {
    const points: [number, number][] = [
      [0, 50],
      [10, 0],
      [20, 100],
      [30, 40],
    ];
    const numbers = (smoothPath(points).match(/C[^C]*/g) ?? []).map((seg) =>
      seg.slice(1).trim().split(/[ ,]/).map(Number),
    );
    numbers.forEach(([, c1y, , c2y, , endY], i) => {
      const a = (points[i] as [number, number])[1];
      const b = (points[i + 1] as [number, number])[1];
      for (const v of [c1y, c2y, endY] as number[]) {
        expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 0.05);
        expect(v).toBeLessThanOrEqual(Math.max(a, b) + 0.05);
      }
    });
  });

  it('linearPath joins points with straight segments', () => {
    expect(
      linearPath([
        [0, 1],
        [2, 3],
      ]),
    ).toBe('M0.0,1.0 L2.0,3.0');
  });

  it('compactNumber uses the pt-PT decimal comma', () => {
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(1200)).toBe('1,2k');
    expect(compactNumber(25_000)).toBe('25k');
    expect(compactNumber(2_500_000)).toBe('2,5M');
    expect(compactNumber(-1200)).toBe('-1,2k');
  });
});

const lineProps = {
  label: 'Net worth',
  empty: 'No data',
  periodHeader: 'Month',
} as const;

describe('LineChart', () => {
  it('renders an accessible svg and a hidden data table', () => {
    const html = renderToStaticMarkup(
      <LineChart
        {...lineProps}
        labels={['jan', 'fev', 'mar']}
        series={[{ name: 'Total', values: [100, 150, 130] }]}
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Net worth"');
    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain('150,00');
    expect(html).toContain('stroke-linecap="round"');
  });

  it('shows the empty message with no data', () => {
    const html = renderToStaticMarkup(<LineChart {...lineProps} labels={[]} series={[]} />);
    expect(html).toContain('No data');
    expect(html).not.toContain('<svg');
  });

  it('shows the empty message when every value is non-finite', () => {
    const html = renderToStaticMarkup(
      <LineChart {...lineProps} labels={['a']} series={[{ name: 'x', values: [Number.NaN] }]} />,
    );
    expect(html).toContain('No data');
  });

  it('draws a single point as a marker without a line', () => {
    const html = renderToStaticMarkup(
      <LineChart {...lineProps} labels={['jan']} series={[{ name: 'Total', values: [100] }]} />,
    );
    expect(html).toContain('<circle');
    expect(html).not.toContain('fill="none" stroke="#9D6BFF" stroke-width="2.5"');
  });

  it('handles negative values', () => {
    const html = renderToStaticMarkup(
      <LineChart
        {...lineProps}
        labels={['a', 'b', 'c']}
        series={[{ name: 'Result', values: [-50, -10, 30] }]}
      />,
    );
    expect(html).toContain('-50,00');
    expect(html).not.toContain('NaN');
  });

  it('renders the period selector slot and dashed series without an end marker', () => {
    const html = renderToStaticMarkup(
      <LineChart
        {...lineProps}
        periodSlot={<span>period-slot</span>}
        labels={['a', 'b']}
        series={[{ name: 'Plan', values: [1, 2], dash: true }]}
      />,
    );
    expect(html).toContain('period-slot');
    expect(html).toContain('stroke-dasharray="5 4"');
    expect(html).not.toContain('r="4"');
  });
});

describe('Sparkline', () => {
  it('renders decoratively', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 3, 2, 5]} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<path');
  });

  it('handles one value and no values', () => {
    expect(renderToStaticMarkup(<Sparkline values={[4]} />)).toContain('<path');
    expect(renderToStaticMarkup(<Sparkline values={[]} />)).toBe('');
  });
});

const segments = [
  { name: 'Casa', value: 750, color: '#F2913D' },
  { name: 'Carro', value: 250, color: '#3BA7F2' },
];

describe('Donut', () => {
  it('shows the total in the centre and a legend with value and percentage', () => {
    const html = renderToStaticMarkup(
      <Donut segments={segments} label="Expenses" centerLabel="Total" />,
    );
    expect(html).toContain('aria-label="Expenses"');
    expect(html).toContain('1\u00a0000,00\u00a0€');
    expect(html).toContain('75,0%');
    expect(html).toContain('25,0%');
    expect(html).toContain('stroke-width="18"');
  });

  it('handles an empty or all-zero distribution', () => {
    const html = renderToStaticMarkup(
      <Donut segments={[{ name: 'x', value: 0, color: '#000' }]} label="Empty" />,
    );
    expect(html).toContain('0,00\u00a0€');
    expect(html).toContain('0,0%');
    expect(html).not.toContain('NaN');
    expect(renderToStaticMarkup(<Donut segments={[]} label="Empty" legend="none" />)).toContain(
      '<svg',
    );
  });

  it('ignores negative values and can drop the legend', () => {
    const html = renderToStaticMarkup(
      <Donut
        segments={[{ name: 'Loss', value: -5, color: '#E5424D' }, ...segments]}
        label="Mix"
        legend="none"
      />,
    );
    expect(html).not.toContain('<ul');
    expect(html).toContain('1\u00a0000,00\u00a0€');
  });
});

describe('ChartLegend', () => {
  it('lists every segment', () => {
    const html = renderToStaticMarkup(<ChartLegend segments={segments} />);
    expect(html).toContain('Casa');
    expect(html).toContain('Carro');
  });
});

describe('BarChart', () => {
  const props = { label: 'Dividends', empty: 'Nothing', periodHeader: 'Month' } as const;

  it('highlights the current month with the warm gradient and a value bubble', () => {
    const html = renderToStaticMarkup(
      <BarChart {...props} labels={['jan', 'fev', 'mar']} values={[10, 20, 30]} highlight={1} />,
    );
    expect(html).toContain('stop-color="#F2913D"');
    expect(html).toContain('font-weight="700"');
    expect(html).toContain('20,00\u00a0€');
    expect(html).toContain('<table class="sr-only">');
  });

  it('draws forecast bars where the real value is zero', () => {
    const html = renderToStaticMarkup(
      <BarChart
        {...props}
        labels={['jan', 'fev']}
        values={[10, 0]}
        forecast={[0, 8]}
        forecastNote="(est.)"
      />,
    );
    expect(html).toContain('fev: 8,00\u00a0€ (est.)');
  });

  it('shows the empty message with no data or only zeros', () => {
    expect(renderToStaticMarkup(<BarChart {...props} labels={[]} values={[]} />)).toContain(
      'Nothing',
    );
    expect(renderToStaticMarkup(<BarChart {...props} labels={['a']} values={[0]} />)).toContain(
      'Nothing',
    );
  });

  it('treats negative values as zero', () => {
    const html = renderToStaticMarkup(<BarChart {...props} labels={['a', 'b']} values={[-4, 6]} />);
    expect(html).not.toContain('NaN');
    expect(html).toContain('6,00\u00a0€');
  });
});
