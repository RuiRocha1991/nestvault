'use client';

import { cn } from '../cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Every option is inert (the choice is fixed). */
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex flex-wrap rounded-sm border border-line bg-inset p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            'h-[26px] whitespace-nowrap rounded-[5px] px-2.5 text-sm font-semibold',
            option.value === value ? 'bg-accent text-on-accent' : 'text-fg-2 hover:text-fg',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
