import { Chip } from '@nestvault/ui';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { PoolSummary } from '@webapp/lib/pool';

/** The owner stands out; a lookup, not a role comparison (permissions decide access). */
const ROLE_TONE = {
  owner: 'accent',
  admin: 'default',
  member: 'default',
  viewer: 'default',
} as const;

export interface PoolCardProps {
  id: string;
  name: string;
  role: PoolSummary['role'];
  memberCount: number;
  /** Already formatted ("hoje", "há 3 dias"). */
  lastActivity: string;
}

/** One pool of the chooser (screen 62). The name is user content: React escapes it. */
export function PoolCard({ id, name, role, memberCount, lastActivity }: PoolCardProps) {
  const t = useTranslations('pools');
  return (
    <li className="flex flex-col gap-3.5 rounded-md bg-panel px-5 py-[18px] shadow-card">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-[34px] shrink-0 place-items-center rounded-md bg-panel-2 text-accent-2"
        >
          <Users className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-lg font-semibold">{name}</h2>
          <p className="text-sm text-fg-3">{t('members', { count: memberCount })}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={ROLE_TONE[role]}>{t(`roles.${role}`)}</Chip>
        <span className="ml-auto text-sm text-fg-3">
          {t('lastActivity', { when: lastActivity })}
        </span>
      </div>
      <Link
        href={`/${id}`}
        aria-label={t('openLabel', { name })}
        className="inline-flex h-[38px] items-center justify-center rounded-sm border border-accent bg-accent text-md font-semibold text-on-accent no-underline transition-colors hover:border-accent-2 hover:bg-accent-2"
      >
        {t('open')}
      </Link>
    </li>
  );
}
