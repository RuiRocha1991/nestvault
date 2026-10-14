'use client';

import { cn, Input } from '@nestvault/ui';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { fieldClass, FIELD_ICON_CLASS } from '@webapp/components/auth/field';

export interface PasswordInputProps extends Omit<ComponentProps<typeof Input>, 'type'> {
  showLabel: string;
  hideLabel: string;
  invalid?: boolean;
}

/** Password field with the key icon and the show / hide toggle of the sign-in screen. */
export function PasswordInput({
  showLabel,
  hideLabel,
  invalid,
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative flex">
      <KeyRound aria-hidden className={FIELD_ICON_CLASS} />
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        aria-invalid={invalid}
        className={cn(fieldClass(invalid), 'pr-10', className)}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="absolute right-1.5 top-[5px] grid size-[30px] place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-3 hover:text-fg"
      >
        {visible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}
