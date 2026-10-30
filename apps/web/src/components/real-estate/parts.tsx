import { Eyebrow, cn } from '@nestvault/ui';
import type { ReactNode } from 'react';

/** A labelled figure of a summary strip. */
export function Stat({
  label,
  children,
  hint,
  tone,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Eyebrow>{label}</Eyebrow>
      <b
        className={cn(
          'text-[22px] font-extrabold leading-tight tracking-[-0.01em] tabular-nums',
          tone === 'pos' && 'text-pos',
          tone === 'neg' && 'text-neg',
        )}
      >
        {children}
      </b>
      {!!hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
  );
}

/** A label on the left and a value on the right, like the rows of a property card. */
export function KeyRow({
  label,
  children,
  strong,
  tone,
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-fg-3">{label}</dt>
      <dd
        className={cn(
          'm-0 text-right tabular-nums',
          strong && 'font-bold',
          tone === 'pos' && 'text-pos',
          tone === 'neg' && 'text-neg',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** Positive amounts green, negative red, with the sign shown. */
export const signTone = (value: string): 'pos' | 'neg' | undefined =>
  value.startsWith('-') ? 'neg' : Number(value) > 0 ? 'pos' : undefined;
