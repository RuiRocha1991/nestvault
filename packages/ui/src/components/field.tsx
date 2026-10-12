import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

import { cn } from '../cn';

const controlStyles =
  'h-[34px] w-full rounded-sm border border-line-2 bg-inset px-2.5 text-base text-fg ' +
  'placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlStyles, className)} {...props} />;
}

/** Native select, styled with the tokens (keyboard and mobile behaviour come for free). */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlStyles, 'pr-7', className)} {...props}>
      {children}
    </select>
  );
}
