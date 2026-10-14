import type { ReactNode } from 'react';

import { cn } from '../cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-md border border-dashed border-line-2 p-6 text-center text-fg-2',
        className,
      )}
    >
      <b className="text-lg text-fg">{title}</b>
      {!!description && <p>{description}</p>}
      {action}
    </div>
  );
}
