import { cn } from '../cn';

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  label: string;
  /** Fill colour (CSS colour). Defaults to the accent. */
  color?: string;
  thick?: boolean;
  warm?: boolean;
  className?: string;
}

export function ProgressBar({ value, label, color, thick, warm, className }: ProgressBarProps) {
  const percent = clamp(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={cn('overflow-hidden rounded-[5px] bg-inset', thick ? 'h-2' : 'h-[5px]', className)}
    >
      <i
        className={cn('block h-full rounded-[5px]', warm ? 'bg-grad-warm' : 'bg-accent-2')}
        style={{ width: `${percent}%`, ...(color && !warm ? { background: color } : {}) }}
      />
    </div>
  );
}

export interface ProgressRingProps {
  value: number;
  label: string;
  color?: string;
  size?: number;
  stroke?: number;
  className?: string;
}

export function ProgressRing({
  value,
  label,
  color = 'var(--accent-2)',
  size = 56,
  stroke = 6,
  className,
}: ProgressRingProps) {
  const percent = clamp(value);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--inset)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-fg text-xs font-bold"
      >
        {`${Math.round(percent)}%`}
      </text>
    </svg>
  );
}
