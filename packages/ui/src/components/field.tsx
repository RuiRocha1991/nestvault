import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

import { cn } from '../cn';

const controlStyles =
  'h-[34px] rounded-sm border border-line-2 bg-inset px-2.5 text-base text-fg ' +
  'placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

const compactStyles =
  'h-7 w-auto rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-medium text-fg ' +
  'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

/** Full width unless the caller sets its own `w-…` class (there is no class merging). */
const widthOf = (className: string | undefined) =>
  /(^|\s)w-/.test(className ?? '') ? undefined : 'w-full';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlStyles, widthOf(className), className)} {...props} />;
}

/** Native select, styled with the tokens (keyboard and mobile behaviour come for free). */
export function Select({
  className,
  children,
  compact = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** The small, content-width select of a card header (the prototype's `.sel`). */
  compact?: boolean;
}) {
  return (
    <select
      className={cn(
        compact ? compactStyles : [controlStyles, widthOf(className)],
        'pr-7',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
