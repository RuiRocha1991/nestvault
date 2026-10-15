import { Chip, formatDate } from '@nestvault/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { InvitePreview } from '@webapp/lib/invite';

/** The pool card of screens 58-60: name, who invited and the role. Names are user content, escaped by React. */
export function InvitePoolCard({
  poolName,
  inviterName,
  role,
}: Pick<InvitePreview, 'poolName' | 'inviterName' | 'role'>) {
  const t = useTranslations('invite');
  const tRoles = useTranslations('pools.roles');
  return (
    <div className="flex items-center gap-3 rounded-md bg-bg px-3 py-3">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-md bg-panel-2 text-accent-2"
      >
        <Users className="size-[18px]" />
      </span>
      <div className="flex min-w-0 flex-col">
        <b className="truncate text-md">{poolName}</b>
        <span className="truncate text-sm text-fg-3">
          {inviterName ? t('invitedBy', { inviter: inviterName }) : t('invitedByUnknown')}
        </span>
      </div>
      <Chip tone="accent" className="ml-auto">
        {tRoles(role)}
      </Chip>
    </div>
  );
}

/** Invite email, role description and expiry (screens 58 and 59). */
export function InviteDetails({
  email,
  role,
  expiresAt,
}: Pick<InvitePreview, 'email' | 'role' | 'expiresAt'>) {
  const t = useTranslations('invite');
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-fg-3">{t('email')}</dt>
      <dd className="m-0 break-all text-right font-medium">{email}</dd>
      <dt className="text-fg-3">{t('role')}</dt>
      <dd className="m-0 text-right font-medium">{t(`roleText.${role}`)}</dd>
      <dt className="text-fg-3">{t('validUntil')}</dt>
      <dd className="m-0 text-right font-medium tabular-nums">{formatDate(expiresAt)}</dd>
    </dl>
  );
}
