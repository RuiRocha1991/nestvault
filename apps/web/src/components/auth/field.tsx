import { cn, Input } from '@nestvault/ui';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/** The leading icon of a field: 18 px, vertically centred on a 40 px input. */
export const FIELD_ICON_CLASS =
  'pointer-events-none absolute left-3 top-[11px] size-[18px] text-fg-3';

/** Height, room for the icon and the red outline of an invalid field. */
export const fieldClass = (invalid?: boolean) =>
  cn('h-10 pl-[38px]', invalid && 'border-neg shadow-[inset_0_0_0_1px_var(--neg)]');

/** A text input with a lucide icon on the left. */
export function IconInput({
  icon: Icon,
  invalid,
  className,
  ...props
}: ComponentProps<typeof Input> & { icon: LucideIcon; invalid?: boolean }) {
  return (
    <div className="relative flex">
      <Icon aria-hidden className={FIELD_ICON_CLASS} />
      <Input aria-invalid={invalid} className={cn(fieldClass(invalid), className)} {...props} />
    </div>
  );
}

/** Label, the control and its error text. `aside` sits on the right of the label (a link). */
export function Field({
  id,
  label,
  aside,
  error,
  children,
}: {
  id: string;
  label: string;
  aside?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  const labelElement = (
    <label htmlFor={id} className="text-sm font-medium text-fg-2">
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {aside ? (
        <div className="flex items-baseline justify-between gap-2">
          {labelElement}
          {aside}
        </div>
      ) : (
        labelElement
      )}
      {children}
      {!!error && <p className="text-sm text-neg">{error}</p>}
    </div>
  );
}
