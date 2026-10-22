import { useId } from 'react';

import { smoothPath } from './geometry';
import type { Point } from './geometry';

export interface SparklineProps {
  values: readonly number[];
  /** Start of the line gradient. */
  from?: string;
  /** End of the line gradient and colour of the area. */
  to?: string;
  className?: string;
}

const WIDTH = 200;
const HEIGHT = 64;
const MARGIN = 6;

/** Decorative trend line for KPI cards (the number next to it carries the information). */
export function Sparkline({
  values,
  from = 'var(--accent-2)',
  to = 'var(--accent-2)',
  className,
}: SparklineProps) {
  const id = useId();
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  const series = clean.length === 1 ? [clean[0] as number, clean[0] as number] : clean;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const points: Point[] = series.map((v, i) => [
    i * (WIDTH / (series.length - 1)),
    MARGIN + (1 - (v - min) / range) * (HEIGHT - 2 * MARGIN),
  ]);
  const path = smoothPath(points);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className ?? 'h-16 w-full'}
    >
      <defs>
        <linearGradient id={`${id}s`} x1="0" x2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={to} stopOpacity="0.28" />
          <stop offset="1" stopColor={to} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} fill={`url(#${id}f)`} />
      <path
        d={path}
        fill="none"
        stroke={`url(#${id}s)`}
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
