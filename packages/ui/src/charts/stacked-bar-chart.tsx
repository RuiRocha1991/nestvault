import type { ReactNode } from 'react';

import { cn } from '../cn';
import { formatMoney } from '../format';

import { compactNumber, niceTicks } from './geometry';

export interface StackedSeries {
  name: string;
  /** One non-negative value per label. */
  values: readonly number[];
  /** CSS colour. */
  color: string;
}

export interface StackedBarChartProps {
  labels: readonly string[];
  /** Bottom to top. */
  series: readonly StackedSeries[];
  /** Bars drawn faded (projections), by index. */
  faded?: ReadonlySet<number>;
  /** Label shown under every nth bar (the others only get a tooltip). */
  labelEvery?: number;
  currency?: string;
  /** Accessible name of the chart. */
  label: string;
  /** Shown instead of the chart when there are no bars. */
  empty: ReactNode;
  /** Header of the label column in the hidden data table. */
  periodHeader: string;
  height?: number;
  className?: string;
}

const WIDTH = 640;
const PAD = { left: 40, right: 8, top: 10, bottom: 24 } as const;

const positive = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/** Stacked vertical bars (capital and interest per contract year); faded bars are projections. */
export function StackedBarChart({
  labels,
  series,
  faded,
  labelEvery = 1,
  currency = 'EUR',
  label,
  empty,
  periodHeader,
  height = 240,
  className,
}: StackedBarChartProps) {
  if (!labels.length) {
    return <p className={cn('py-8 text-center text-sm text-fg-3', className)}>{empty}</p>;
  }
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + positive(s.values[i]), 0));
  const ticks = niceTicks(0, Math.max(...totals, 1));
  const top = ticks.at(-1) ?? 1;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / labels.length;
  const barW = Math.max(2, Math.min(18, slot * 0.7));
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label} className="w-full">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--fg-3)"
            >
              {compactNumber(tick)}
            </text>
          </g>
        ))}
        {labels.map((text, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          let acc = 0;
          return (
            <g key={`${i}-${text}`} opacity={faded?.has(i) ? 0.45 : 1}>
              {series.map((s) => {
                const value = positive(s.values[i]);
                const from = acc;
                acc += value;
                if (value <= 0) return null;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={y(acc)}
                    width={barW}
                    height={y(from) - y(acc)}
                    fill={s.color}
                  >
                    <title>{`${text} · ${s.name}: ${formatMoney(value, currency)}`}</title>
                  </rect>
                );
              })}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--fg-3)"
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{periodHeader}</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((text, i) => (
            <tr key={`${i}-${text}`}>
              <th scope="row">{text}</th>
              {series.map((s) => (
                <td key={s.name}>{formatMoney(positive(s.values[i]), currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
