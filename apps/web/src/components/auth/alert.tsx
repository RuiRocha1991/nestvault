import { cn } from '@nestvault/ui';
import { Clock, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatCountdown } from '@webapp/lib/sign-in';

const alertStyles = {
  error: 'border-neg bg-[color-mix(in_srgb,var(--neg)_12%,transparent)] [&_svg]:text-neg',
  warning: 'border-warn bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] [&_svg]:text-warn',
  info: 'border-accent bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] [&_svg]:text-accent-2',
};

export function Alert({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof alertStyles;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'info' ? 'note' : 'alert'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-md [&_svg]:mt-px [&_svg]:size-[18px] [&_svg]:shrink-0',
        alertStyles[tone],
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}

const tileStyles = {
  success: 'bg-[color-mix(in_srgb,var(--pos)_16%,transparent)] text-pos',
  warning: 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn',
  accent: 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent-2',
};

/** The 56 px rounded square with an icon at the top of the status cards. */
export function IconTile({
  tone,
  children,
}: {
  tone: keyof typeof tileStyles;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn('grid size-14 place-items-center rounded-md [&_svg]:size-6', tileStyles[tone])}
    >
      {children}
    </div>
  );
}

export function LinkButton({
  href,
  children,
  primary = true,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        'inline-flex h-[42px] w-full items-center justify-center rounded-sm border text-base font-semibold no-underline transition-colors',
        primary
          ? 'border-accent bg-accent text-on-accent hover:border-accent-2 hover:bg-accent-2'
          : 'border-line-2 bg-panel-2 text-fg hover:border-accent-2',
      )}
    >
      {children}
    </a>
  );
}

/** Error banner of the auth forms: a bold title and a muted explanation. */
export function ProblemAlert({ title, text }: { title: string; text: string }) {
  return (
    <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
      <b>{title}</b>
      <br />
      <span className="text-fg-2">{text}</span>
    </Alert>
  );
}

/** Banner for a rate-limit pause; the text renders `<Countdown />` where the time goes. */
export function LockedAlert({ title, text }: { title: string; text: ReactNode }) {
  return (
    <Alert tone="warning" icon={<Clock aria-hidden />}>
      <b>{title}</b>
      <br />
      <span className="text-fg-2">{text}</span>
    </Alert>
  );
}

export function Countdown({ seconds }: { seconds: number }) {
  return <b className="tabular-nums">{formatCountdown(seconds)}</b>;
}
