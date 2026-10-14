import { Check, Clock, Lock, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconTile } from '@webapp/components/auth/alert';

type Tone = 'success' | 'warning' | 'accent' | 'locked';
const ICONS: Record<Tone, ReactNode> = {
  locked: <Lock />,
  success: <Check />,
  warning: <Clock />,
  accent: <Mail />,
};

const TILE_TONE = {
  success: 'success',
  warning: 'warning',
  accent: 'accent',
  locked: 'accent',
} as const;

/** Icon tile, title, text and the actions: screens 55 and 57 and the verification card. */
export function LinkStatus({
  tone,
  title,
  text,
  children,
}: {
  tone: Tone;
  title: string;
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <IconTile tone={TILE_TONE[tone]}>{ICONS[tone]}</IconTile>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{title}</h1>
        <p className="text-md text-fg-2">{text}</p>
      </div>
      {children}
    </>
  );
}
