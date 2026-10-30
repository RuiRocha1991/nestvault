'use client';

import { useId, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';

import { cn } from '../cn';
import { formatMoney } from '../format';

import { compactNumber, linearPath, niceTicks, smoothPath } from './geometry';
import type { Point } from './geometry';
import { seriesColor } from './series-colors';

export interface LineSeries {
  name: string;
  values: readonly number[];
  /** CSS colour; defaults to the design-system series palette. */
  color?: string;
  /** Dashed thin line without area or end marker (e.g. a projection). */
  dash?: boolean;
  /** Straight segments instead of a smooth curve. */
  step?: boolean;
  /** Set to `false` to hide the gradient area. */
  fill?: boolean;
}

export interface LineChartProps {
  labels: readonly string[];
  /** 1–3 series; each has one value per label. */
  series: readonly LineSeries[];
  currency?: string;
  /** Formats a value in the tooltip and the data table; defaults to money in `currency`. */
  formatValue?: (value: number) => string;
  /** Accessible name of the chart. */
  label: string;
  /** Shown instead of the chart when there is nothing to plot. */
  empty: ReactNode;
  /** Header of the label column in the hidden data table. */
  periodHeader: string;
  /** Period selector (e.g. `Segmented`) rendered above the chart. */
  periodSlot?: ReactNode;
  height?: number;
  className?: string;
}

const WIDTH = 640;
const PAD = { left: 44, right: 12, top: 14, bottom: 26 } as const;

function finiteValues(series: readonly LineSeries[]): number[] {
  return series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
}

/** Value range with 12 % headroom; the floor stays at 0 unless a value is negative. */
function valueRange(values: readonly number[]): { min: number; max: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  return { min: lo < 0 ? lo - pad : Math.max(0, lo - pad), max: hi + pad };
}

export function LineChart({
  labels,
  series,
  currency = 'EUR',
  formatValue,
  label,
  empty,
  periodHeader,
  periodSlot,
  height = 230,
  className,
}: LineChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const finite = finiteValues(series);

  const header = !!periodSlot && <div className="flex justify-end">{periodSlot}</div>;
  if (!labels.length || !finite.length) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {header}
        <p className="py-8 text-center text-sm text-fg-3">{empty}</p>
      </div>
    );
  }

  const { min, max } = valueRange(finite);
  const ticks = niceTicks(min, max, 4);
  const y0 = ticks[0] as number;
  const y1 = ticks[ticks.length - 1] as number;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
  const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  const every = Math.ceil(labels.length / 12);
  const baseline = height - PAD.bottom;

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    const index = labels.length === 1 ? 0 : Math.round(ratio * (labels.length - 1));
    setHover(Math.min(labels.length - 1, Math.max(0, index)));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {header}
      <div className="relative">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label} className="w-full">
          <defs>
            {series.map((s, i) => {
              const color = s.color ?? seriesColor(i);
              return (
                <linearGradient key={s.name} id={`${id}g${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity={i === 0 ? 0.36 : 0.16} />
                  <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
              );
            })}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--fg-3)">
                {compactNumber(t)}
              </text>
            </g>
          ))}
          {labels.map((text, i) => {
            if (i % every !== 0 && i !== labels.length - 1) return null;
            return (
              <text
                key={`${i}-${text}`}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--fg-3)"
              >
                {text}
              </text>
            );
          })}
          {series.map((s, i) => {
            const color = s.color ?? seriesColor(i);
            const points: Point[] = s.values.flatMap((v, j) =>
              Number.isFinite(v) ? [[x(j), y(v)] as Point] : [],
            );
            const last = points[points.length - 1];
            if (!last) return null;
            const path = s.step ? linearPath(points) : smoothPath(points);
            const first = points[0] as Point;
            return (
              <g key={s.name}>
                {s.fill !== false && points.length > 1 && (
                  <path
                    d={`${path} L${last[0]},${baseline} L${first[0]},${baseline} Z`}
                    fill={`url(#${id}g${i})`}
                  />
                )}
                {points.length > 1 && (
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={s.dash ? 1.6 : 2.5}
                    strokeDasharray={s.dash ? '5 4' : undefined}
                    strokeLinecap="round"
                  />
                )}
                {!s.dash && (
                  <circle
                    cx={last[0]}
                    cy={last[1]}
                    r="4"
                    fill="var(--panel)"
                    stroke={color}
                    strokeWidth="2.5"
                  />
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={baseline}
                stroke="var(--line-2)"
                strokeDasharray="3 3"
              />
              {series.map((s, i) => {
                const value = s.values[hover];
                if (value === undefined || !Number.isFinite(value)) return null;
                return (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(value)}
                    r={s.dash ? 3 : 5}
                    fill="var(--panel)"
                    stroke={s.color ?? seriesColor(i)}
                    strokeWidth="2.5"
                  />
                );
              })}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => {
              setHover(null);
            }}
          />
        </svg>
        {hover !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 z-10 min-w-32 rounded-sm border border-line-2 bg-panel-2 px-3 py-2 text-xs shadow-card"
            style={{
              left: `${(x(hover) / WIDTH) * 100}%`,
              transform: `translateX(${hover > labels.length / 2 ? '-110%' : '10%'})`,
            }}
          >
            <div className="mb-1 font-semibold text-fg">{labels[hover]}</div>
            {series.map((s, i) => {
              const value = s.values[hover];
              if (value === undefined || !Number.isFinite(value)) return null;
              return (
                <div key={s.name} className="flex items-center gap-2 text-fg-2">
                  <i
                    className="inline-block size-2 rounded-full"
                    style={{ background: s.color ?? seriesColor(i) }}
                  />
                  <span className="mr-auto">{s.name}</span>
                  <b className="text-fg">
                    {formatValue ? formatValue(value) : formatMoney(value, currency)}
                  </b>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
              {series.map((s) => {
                const value = s.values[i];
                return (
                  <td key={s.name}>
                    {value !== undefined && Number.isFinite(value)
                      ? formatValue
                        ? formatValue(value)
                        : formatMoney(value, currency)
                      : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
