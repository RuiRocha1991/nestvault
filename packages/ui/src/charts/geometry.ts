// Pure geometry helpers shared by the SVG charts (port of the prototype `smoothPath` / `niceTicks`).

export type Point = readonly [number, number];

const CONTROL_FACTOR = 0.16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fixed(value: number): string {
  return value.toFixed(1);
}

/**
 * Smooth bezier through `points`. Control points are limited to the vertical range of their
 * segment, so the curve never overshoots a peak or dips below a valley.
 */
export function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  let path = `M${fixed(first[0])},${fixed(first[1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i] as Point;
    const p2 = points[i + 1] as Point;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const c1x = p1[0] + (p2[0] - p0[0]) * CONTROL_FACTOR;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) * CONTROL_FACTOR, lo, hi);
    const c2x = p2[0] - (p3[0] - p1[0]) * CONTROL_FACTOR;
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) * CONTROL_FACTOR, lo, hi);
    path += ` C${fixed(c1x)},${fixed(c1y)} ${fixed(c2x)},${fixed(c2y)} ${fixed(p2[0])},${fixed(p2[1])}`;
  }
  return path;
}

/** Straight segments through `points` (step-like series, e.g. a plan that changes in jumps). */
export function linearPath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fixed(p[0])},${fixed(p[1])}`).join(' ');
}

const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10] as const;

/** Round tick values covering `[min, max]` with about `count` intervals. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const upper = max === min ? min + 1 : max;
  const rawStep = (upper - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = STEP_MULTIPLIERS.map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(upper / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

/** Compact axis label: `1200` → `1,2k`, `2500000` → `2,5M` (pt-PT decimal comma). */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const trim = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
  if (abs >= 1e6) return `${trim(value / 1e6, 1)}M`;
  if (abs >= 1000) return `${trim(value / 1000, abs >= 10000 ? 0 : 1)}k`;
  return String(Math.round(value));
}
