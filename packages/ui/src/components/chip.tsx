import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../cn';

const chipStyles = cva(
  'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-pill px-[9px] text-xs font-semibold',
  {
    variants: {
      tone: {
        default: 'bg-panel-2 text-fg-2',
        accent: 'bg-accent-soft text-accent-2',
        pos: 'bg-panel-2 text-pos',
        neg: 'bg-panel-2 text-neg',
        warn: 'bg-panel-2 text-warn',
        warm: 'bg-grad-warm text-white',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface ChipProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof chipStyles> {
  /** Colour of a leading dot (any CSS colour, e.g. a series colour). */
  dotColor?: string;
}

export function Chip({ className, tone, dotColor, children, ...props }: ChipProps) {
  return (
    <span className={cn(chipStyles({ tone }), className)} {...props}>
      {!!dotColor && (
        <i aria-hidden className="size-[7px] rounded-full" style={{ background: dotColor }} />
      )}
      {children}
    </span>
  );
}
