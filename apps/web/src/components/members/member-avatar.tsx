import { cn } from '@nestvault/ui';

import { avatarColor } from '@webapp/lib/audit-view';

const SIZES = {
  sm: 'size-[22px] text-xs',
  md: 'size-[30px] text-sm',
} as const;

/** The round initial of a person, coloured from their id so the same person looks the same everywhere. */
export function MemberAvatar({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-white',
        SIZES[size],
      )}
      style={{ background: avatarColor(id) }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
