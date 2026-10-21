'use client';

import { cn, Input, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';

import { Field } from '@webapp/components/auth/field';
import type { PeriodUnit } from '@webapp/lib/account-form';

/** A red outline for an invalid control. */
export const invalidClass = (invalid: boolean) =>
  invalid && 'border-neg shadow-[inset_0_0_0_1px_var(--neg)]';

/** Two controls side by side that wrap on a narrow screen. */
export function FormRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">{children}</div>
  );
}

export function Hint({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={cn('m-0 text-sm', error ? 'text-neg' : 'text-fg-3')}>{children}</p>;
}

/** A labelled text control with its hint, or its error text in place of the hint. */
export function TextField({
  id,
  label,
  hint,
  error,
  ...props
}: Omit<ComponentProps<typeof Input>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
}) {
  return (
    <Field id={id} label={label} error={error}>
      <Input
        id={id}
        autoComplete="off"
        aria-invalid={!!error}
        {...props}
        className={cn(invalidClass(!!error), props.className)}
      />
      {!!hint && !error && <Hint>{hint}</Hint>}
    </Field>
  );
}

/** A number and its unit (months or days), the shape of every period in the forms. */
export function PeriodField({
  id,
  label,
  hint,
  error,
  amount,
  unit,
  onAmount,
  onUnit,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string | undefined;
  amount: string;
  unit: PeriodUnit;
  onAmount: (value: string) => void;
  onUnit: (value: PeriodUnit) => void;
}) {
  const t = useTranslations('accounts.dialog.units');
  return (
    <Field id={id} label={label} error={error}>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={!!error}
          className={cn(invalidClass(!!error))}
          value={amount}
          onChange={(event) => {
            onAmount(event.target.value);
          }}
        />
        <Select
          aria-label={label}
          value={unit}
          onChange={(event) => {
            onUnit(event.target.value as PeriodUnit);
          }}
        >
          <option value="m">{t('m')}</option>
          <option value="d">{t('d')}</option>
        </Select>
      </div>
      {!error && <Hint>{hint}</Hint>}
    </Field>
  );
}
