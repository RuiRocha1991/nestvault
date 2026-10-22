import { cn } from '../cn';
import { formatMoney, formatPct } from '../format';

export interface DonutSegment {
  name: string;
  /** Non-negative amount; negative or non-finite values count as 0. */
  value: number;
  color: string;
}

export interface DonutProps {
  segments: readonly DonutSegment[];
  currency?: string;
  /** Accessible name of the chart. */
  label: string;
  /** Small text in the centre above the total (e.g. "Total"). */
  centerLabel?: string;
  /** Text in the centre; defaults to the formatted total. */
  centerValue?: string;
  size?: number;
  stroke?: number;
  /** Legend to the right (default) or below the ring. */
  legend?: 'right' | 'below' | 'none';
  className?: string;
}

function amount(segment: DonutSegment): number {
  return Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0;
}

export function Donut({
  segments,
  currency = 'EUR',
  label,
  centerLabel,
  centerValue,
  size = 150,
  stroke = 16,
  legend = 'right',
  className,
}: DonutProps) {
  const total = segments.reduce((sum, s) => sum + amount(s), 0);
  const center = size / 2;
  const radius = size / 2 - stroke / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const gap = segments.length > 1 ? 2 : 0;
  const totalText = centerValue ?? formatMoney(total, currency);

  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = total > 0 ? (amount(segment) / total) * circumference : 0;
    const arc = { segment, length, offset };
    offset += length;
    return arc;
  });

  return (
    <div
      className={cn(
        'flex items-center gap-5',
        legend === 'below' ? 'flex-col' : 'flex-wrap',
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="shrink-0"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--inset)"
          strokeWidth={stroke}
        />
        {arcs.map(
          ({ segment, length, offset: start }) =>
            length > 0 && (
              <circle
                key={segment.name}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${center} ${center})`}
              >
                <title>{`${segment.name}: ${formatMoney(segment.value, currency)}`}</title>
              </circle>
            ),
        )}
        {!!centerLabel && (
          <text x="50%" y={center - 6} textAnchor="middle" fontSize="11" fill="var(--fg-2)">
            {centerLabel}
          </text>
        )}
        <text
          x="50%"
          y={center + (centerLabel ? 14 : 6)}
          textAnchor="middle"
          fontSize={totalText.length > 9 ? 15 : 18}
          fontWeight="700"
          fill="var(--fg)"
        >
          {totalText}
        </text>
      </svg>
      {legend !== 'none' && (
        <ChartLegend segments={segments} currency={currency} className="min-w-44 flex-1" />
      )}
    </div>
  );
}

export interface ChartLegendProps {
  segments: readonly DonutSegment[];
  currency?: string;
  className?: string;
}

/** Colour swatch, name, value and share of the total per segment. */
export function ChartLegend({ segments, currency = 'EUR', className }: ChartLegendProps) {
  const total = segments.reduce((sum, s) => sum + amount(s), 0);
  return (
    <ul className={cn('flex flex-col gap-2 text-sm', className)}>
      {segments.map((segment) => (
        <li key={segment.name} className="flex items-center gap-2">
          <i
            className="inline-block size-[9px] shrink-0 rounded-full"
            style={{ background: segment.color }}
          />
          <span className="mr-auto min-w-0 truncate">{segment.name}</span>
          <b className="tabular-nums">{formatMoney(amount(segment), currency)}</b>
          <span className="w-12 text-right tabular-nums text-fg-3">
            {formatPct(total > 0 ? (amount(segment) / total) * 100 : 0)}
          </span>
        </li>
      ))}
    </ul>
  );
}
