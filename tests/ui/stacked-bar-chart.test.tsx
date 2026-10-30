import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LineChart, StackedBarChart } from '@nestvault/ui';

const props = {
  labels: ['2020', '2021', '2022'],
  series: [
    { name: 'Capital', values: [100, 200, 0], color: '#9D6BFF' },
    { name: 'Juros', values: [50, 25, 10], color: '#F2913D' },
  ],
  label: 'Capital e juros',
  periodHeader: 'Ano',
  empty: 'Sem dados',
};

describe('StackedBarChart', () => {
  it('draws a segment per series and value, and a data table for screen readers', () => {
    const html = renderToStaticMarkup(<StackedBarChart {...props} />);
    // 3 bars x 2 series, minus the zero capital of the last one
    expect(html.match(/<rect/g)).toHaveLength(5);
    expect(html).toContain('<caption>Capital e juros</caption>');
    expect(html).toContain('2021');
  });

  it('fades the projected bars', () => {
    const html = renderToStaticMarkup(<StackedBarChart {...props} faded={new Set([2])} />);
    expect(html).toContain('opacity="0.45"');
  });

  it('shows the empty text without bars', () => {
    const html = renderToStaticMarkup(<StackedBarChart {...props} labels={[]} series={[]} />);
    expect(html).toContain('Sem dados');
    expect(html).not.toContain('<svg');
  });

  it('labels only every nth bar', () => {
    const html = renderToStaticMarkup(<StackedBarChart {...props} labelEvery={2} />);
    const axis = html.match(/<text[^>]*text-anchor="middle"[^>]*>(\d{4})<\/text>/g) ?? [];
    expect(axis).toHaveLength(2);
  });
});

describe('LineChart formatValue', () => {
  it('formats the data table with the given formatter', () => {
    const html = renderToStaticMarkup(
      <LineChart
        labels={['a', 'b']}
        series={[{ name: 'Taxa', values: [2.4, 4.1], step: true }]}
        formatValue={(value) => `${value.toFixed(1)} %`}
        label="Taxa"
        periodHeader="Mês"
        empty="Sem dados"
      />,
    );
    expect(html).not.toContain('€');
  });
});
