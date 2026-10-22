import { useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../cn';
import { formatMoney } from '../format';

export interface BarChartProps {
  labels: readonly string[];
  /** One non-negative value per label. */
  values: readonly number[];
  /** Estimated values, drawn in the warm colour where the real value is 0. */
  forecast?: readonly number[];
  /** Index of the current month: warm gradient, bold label and value bubble. */
  highlight?: number;
  currency?: string;
  /** Accessible name of the chart. */
  label: string;
  /** Shown instead of the chart when there are no months at all. */
  empty: ReactNode;
  /** Suffix of the tooltip of an estimated bar (e.g. "(previsto)"). */
  forecastNote?: string;
  /** Header of the label column in the hidden data table. */
  periodHeader: string;
  height?: number;
  /** Width of the drawing in viewBox units (the bars scale with it); default 440. */
  width?: number;
  className?: string;
}

const DEFAULT_WIDTH = 440;
const TOP = 34;
const BOTTOM = 26;
const BUBBLE_W = 76;

function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export function BarChart({
  labels,
  values,
  forecast,
  highlight = -1,
  currency = 'EUR',
  label,
  empty,
  forecastNote = '',
  periodHeader,
  height = 200,
  width: WIDTH = DEFAULT_WIDTH,
  className,
}: BarChartProps) {
  const id = useId();
  const real = labels.map((_, i) => positive(values[i]));
  const estimated = labels.map((_, i) => (real[i] ? 0 : positive(forecast?.[i])));
  // Nothing to plot still draws the empty tracks, like the prototype; only no months shows the text.
  const max = Math.max(...real, ...estimated, 1);
  if (!labels.length) {
    return <p className={cn('py-8 text-center text-sm text-fg-3', className)}>{empty}</p>;
  }

  const slot = (WIDTH - 8) / labels.length;
  const barW = Math.min(20, slot * 0.5);
  const plotH = height - TOP - BOTTOM;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label} className="w-full">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#A97BFF" />
            <stop offset="1" stopColor="#6A2BD9" />
          </linearGradient>
          <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F2913D" />
            <stop offset="1" stopColor="#E5424D" />
          </linearGradient>
        </defs>
        {labels.map((text, i) => {
          const isForecast = !real[i] && !!estimated[i];
          const value = real[i] || estimated[i] || 0;
          const barH = value > 0 ? Math.max(3, (value / max) * plotH) : 0;
          const x = 4 + slot * i + slot / 2 - barW / 2;
          const isHighlight = i === highlight;
          const warm = isHighlight || isForecast;
          const bubbleX = Math.min(WIDTH - BUBBLE_W / 2, Math.max(BUBBLE_W / 2, x + barW / 2));
          const bubbleY = Math.max(0, height - BOTTOM - barH - 34);
          return (
            <g key={`${i}-${text}`}>
              <rect x={x} y={TOP} width={barW} height={plotH} rx={barW / 2} fill="var(--inset)" />
              {barH > 0 && (
                <rect
                  x={x}
                  y={height - BOTTOM - barH}
                  width={barW}
                  height={barH}
                  rx={Math.min(barW / 2, barH / 2)}
                  fill={`url(#${id}${warm ? 'w' : 'b'})`}
                  opacity={isForecast ? 0.8 : 1}
                >
                  <title>
                    {`${text}: ${formatMoney(value, currency)}${isForecast && forecastNote ? ` ${forecastNote}` : ''}`}
                  </title>
                </rect>
              )}
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill={isHighlight ? 'var(--fg)' : 'var(--fg-3)'}
                fontWeight={isHighlight ? 700 : 400}
              >
                {text}
              </text>
              {isHighlight && value > 0 && (
                <g>
                  <rect
                    x={bubbleX - BUBBLE_W / 2}
                    y={bubbleY}
                    width={BUBBLE_W}
                    height="26"
                    rx="6"
                    fill="var(--panel-2)"
                    stroke="var(--line-2)"
                  />
                  <text
                    x={bubbleX}
                    y={bubbleY + 17}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--fg)"
                  >
                    {formatMoney(value, currency)}
                  </text>
                </g>
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
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((text, i) => (
            <tr key={`${i}-${text}`}>
              <th scope="row">{text}</th>
              <td>{formatMoney(real[i] || estimated[i] || 0, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
