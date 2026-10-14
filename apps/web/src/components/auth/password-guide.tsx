import { cn } from '@nestvault/ui';
import { Check } from 'lucide-react';

export interface PasswordGuideProps {
  /** 0 to 4, from `checkPassword`. */
  score: 0 | 1 | 2 | 3 | 4;
  /** True once something is typed: the level text and the checklist appear. */
  active: boolean;
  meterLabel: string;
  /** The five level names, weakest first. */
  levels: readonly string[];
  /** Shown after the level name while the password could still be stronger. */
  hint?: string;
  rules: readonly { ok: boolean; label: string }[];
}

/** Strength meter, level text and the checklist under a new-password field (advisory only). */
export function PasswordGuide({
  score,
  active,
  meterLabel,
  levels,
  hint,
  rules,
}: PasswordGuideProps) {
  const level = levels[score] ?? '';
  return (
    <>
      <div
        role="meter"
        aria-label={meterLabel}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={level}
        className="mt-1 grid grid-cols-4 gap-1.5"
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 rounded-full',
              step <= score ? (score >= 3 ? 'bg-pos' : 'bg-warn') : 'bg-line-2',
            )}
          />
        ))}
      </div>
      {active && (
        <p className={cn('text-sm', score >= 3 ? 'text-pos' : 'text-fg-3')}>
          {hint && score > 0 && score < 4 ? `${level} · ${hint}` : level}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {rules.map((rule) => (
          <li
            key={rule.label}
            className={cn('flex items-center gap-1.5 text-sm', rule.ok ? 'text-pos' : 'text-fg-3')}
          >
            <Check aria-hidden className={cn('size-3.5', !rule.ok && 'opacity-40')} />
            {rule.label}
          </li>
        ))}
      </ul>
    </>
  );
}
