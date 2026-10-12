import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '../cn';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-md', className)} {...props} />
    </div>
  );
}

export interface CellProps {
  /** Right-aligned tabular numbers. */
  numeric?: boolean;
}

export function Th({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-line p-2 text-xs font-semibold uppercase tracking-[0.06em] text-fg-3',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={cn(
        'border-b border-line px-2 py-[9px] align-middle',
        numeric && 'whitespace-nowrap text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
