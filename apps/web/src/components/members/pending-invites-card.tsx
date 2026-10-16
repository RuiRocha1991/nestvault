'use client';

import { Button, Card, Chip, formatDate, Table, Td, Th } from '@nestvault/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { InviteView } from '@webapp/lib/members-view';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { remainingUntil } from '@webapp/lib/relative-time';

export interface PendingInvitesCardProps {
  poolId: string;
  invites: readonly InviteView[];
  /** The server's clock when the page rendered, so the countdowns match on the server and in the browser. */
  now: string;
  onChanged: (message: 'inviteResent' | 'inviteCancelled' | 'inviteFailed') => void;
}

/** Pending invites with the time left on each, and the resend and cancel actions (mockup 64). */
export function PendingInvitesCard({ poolId, invites, now, onChanged }: PendingInvitesCardProps) {
  const t = useTranslations('members.invites');
  const tRoles = useTranslations('pools.roles');
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/v1/pools/${encodeURIComponent(poolId)}/invites`;

  async function act(
    id: string,
    request: () => Promise<Response>,
    done: 'inviteResent' | 'inviteCancelled',
  ) {
    if (busy) return;
    setBusy(id);
    try {
      const response = await request();
      onChanged(response.ok ? done : 'inviteFailed');
    } catch {
      onChanged('inviteFailed');
    }
    setBusy(null);
  }

  return (
    <Card>
      <h2 className="m-0 text-lg font-semibold">{t('title')}</h2>
      {invites.length === 0 ? (
        <p className="m-0 text-md text-fg-3">{t('empty')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('email')}</Th>
              <Th>{t('role')}</Th>
              <Th>{t('expires')}</Th>
              <Th>
                <span className="sr-only">{t('title')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => {
              const remaining = remainingUntil(new Date(invite.expiresAt), new Date(now));
              return (
                <tr key={invite.id}>
                  <Td className="break-all">{invite.email}</Td>
                  <Td>
                    <Chip>{tRoles(invite.role)}</Chip>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className={remaining?.soon || !remaining ? 'text-warn' : undefined}>
                      {remaining
                        ? t(`remaining.${remaining.unit}`, { count: remaining.count })
                        : t('expired')}
                    </span>{' '}
                    <span className="text-sm text-fg-3">{`(${formatDate(new Date(invite.expiresAt))})`}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t('resendLabel', { email: invite.email })}
                      onClick={() => {
                        void act(
                          invite.id,
                          () =>
                            postJson(`${base}/${encodeURIComponent(invite.id)}/resend`, undefined),
                          'inviteResent',
                        );
                      }}
                    >
                      <RefreshCw aria-hidden />
                      {t('resend')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t('cancelLabel', { email: invite.email })}
                      onClick={() => {
                        void act(
                          invite.id,
                          () => sendJson('DELETE', `${base}/${encodeURIComponent(invite.id)}`),
                          'inviteCancelled',
                        );
                      }}
                    >
                      {t('cancel')}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="m-0 text-sm text-fg-3">{t('note')}</p>
    </Card>
  );
}
