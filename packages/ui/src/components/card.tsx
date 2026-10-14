import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-md bg-panel px-5 py-4 shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}

export function CardHeader({ title, subtitle, actions, headingLevel = 2 }: CardHeaderProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <header className="flex flex-wrap items-center gap-2">
      <div className="mr-auto flex min-w-0 flex-col">
        <Heading className="text-lg font-semibold">{title}</Heading>
        {!!subtitle && <p className="text-sm text-fg-3">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-xs font-semibold uppercase tracking-[0.08em] text-fg-3', className)}
      {...props}
    />
  );
}
