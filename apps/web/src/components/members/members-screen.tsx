'use client';

import { Button, Card, Chip, formatDate, Select, Table, Td, Th, useToast } from '@nestvault/ui';
import { ArrowLeftRight, LogOut, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  ASSIGNABLE_ROLES,
  type InviteView,
  type MemberView,
  type RoleCapabilities,
  type RoleName,
} from '@webapp/lib/members-view';
import { formatRelative } from '@webapp/lib/relative-time';

import { ChangeRoleDialog } from './change-role-dialog';
import { InviteDialog } from './invite-dialog';
import { LeavePoolDialog } from './leave-pool-dialog';
import { MemberAvatar } from './member-avatar';
import { PendingInvitesCard } from './pending-invites-card';
import { RemoveMemberDialog } from './remove-member-dialog';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';

export interface MembersScreenProps {
  poolId: string;
  poolName: string;
  /** The server's clock when the page rendered, so relative times match on the server and in the browser. */
  now: string;
  members: readonly MemberView[];
  invites: readonly InviteView[];
  capabilities: RoleCapabilities;
  /** What the caller may do. Hiding is cosmetic: every service call checks it again. */
  canManage: boolean;
  canInvite: boolean;
  canTransfer: boolean;
}

type Dialog =
  | { kind: 'role'; member: MemberView; role: RoleName }
  | { kind: 'remove'; member: MemberView }
  | { kind: 'leave' }
  | { kind: 'transfer' }
  | { kind: 'invite' };

type ToastKey =
  | 'roleChanged'
  | 'removed'
  | 'left'
  | 'transferred'
  | 'inviteSent'
  | 'inviteResent'
  | 'inviteCancelled'
  | 'inviteFailed';

/** Definições → Utilizadores e convites (mockup 64 and modals 66, 67, 72-75). */
export function MembersScreen({
  poolId,
  poolName,
  now,
  members,
  invites,
  capabilities,
  canManage,
  canInvite,
  canTransfer,
}: MembersScreenProps) {
  const t = useTranslations('members');
  const tRoles = useTranslations('pools.roles');
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const you = members.find((member) => member.isYou);
  const soleOwner = !!you?.owner && members.filter((member) => member.owner).length < 2;
  const candidates = members.filter((member) => !member.isYou && !member.owner);

  function finish(message: ToastKey) {
    setDialog(null);
    toast.show(t(`toast.${message}`));
    if (message === 'left') router.push('/pools');
    router.refresh();
  }

  const close = () => {
    setDialog(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {canInvite && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              setDialog({ kind: 'invite' });
            }}
          >
            <Plus aria-hidden />
            {t('invite')}
          </Button>
        </div>
      )}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-lg font-semibold">{t('users.title')}</h2>
          <span className="text-sm text-fg-3">{t('users.count', { count: members.length })}</span>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t('users.name')}</Th>
              <Th>{t('users.role')}</Th>
              <Th>{t('users.joined')}</Th>
              <Th>{t('users.activity')}</Th>
              <Th>
                <span className="sr-only">{t('users.leaveLabel')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <MemberAvatar id={member.id} name={member.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold">
                        <span className="break-words">{member.name}</span>
                        {member.isYou && <Chip tone="accent">{t('users.you')}</Chip>}
                      </div>
                      {!!member.email && (
                        <div className="break-all text-sm text-fg-3">{member.email}</div>
                      )}
                    </div>
                  </div>
                </Td>
                <Td>
                  {canManage ? (
                    <Select
                      aria-label={t('users.roleOf', { name: member.name })}
                      value={member.role}
                      disabled={!member.editable}
                      className="min-w-[150px]"
                      onChange={(event) => {
                        // A change event only fires for another option than the current one.
                        const next = ASSIGNABLE_ROLES.find(
                          (option) => option === event.target.value,
                        );
                        if (next) setDialog({ kind: 'role', member, role: next });
                      }}
                    >
                      {[...new Set<RoleName>([member.role, ...ASSIGNABLE_ROLES])].map((role) => (
                        <option key={role} value={role}>
                          {tRoles(role)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Chip>{tRoles(member.role)}</Chip>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{formatDate(new Date(member.joinedAt))}</Td>
                <Td className="whitespace-nowrap">
                  {member.lastActivityAt
                    ? formatRelative(new Date(member.lastActivityAt), new Date(now))
                    : t('users.noActivity')}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {member.isYou && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('users.leaveLabel')}
                      onClick={() => {
                        setDialog({ kind: 'leave' });
                      }}
                    >
                      <LogOut aria-hidden />
                      {t('users.leave')}
                    </Button>
                  )}
                  {member.editable && (
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={t('users.removeLabel', { name: member.name })}
                      onClick={() => {
                        setDialog({ kind: 'remove', member });
                      }}
                    >
                      <Trash2 aria-hidden />
                      {t('users.remove')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {canManage && (
          <p className="m-0 rounded-md bg-bg px-3 py-2.5 text-sm text-fg-2">{t('users.note')}</p>
        )}
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {canInvite && (
          <PendingInvitesCard poolId={poolId} invites={invites} now={now} onChanged={finish} />
        )}
        {canTransfer && (
          <Card>
            <h2 className="m-0 text-lg font-semibold">{t('ownership.title')}</h2>
            <p className="m-0 text-sm text-fg-3">{t('ownership.lead')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setDialog({ kind: 'transfer' });
                }}
              >
                <ArrowLeftRight aria-hidden />
                {t('ownership.transfer')}
              </Button>
              <Button
                variant="danger"
                disabled={soleOwner}
                onClick={() => {
                  setDialog({ kind: 'leave' });
                }}
              >
                <LogOut aria-hidden />
                {t('ownership.leave')}
              </Button>
            </div>
            {soleOwner && <p className="m-0 text-sm text-fg-3">{t('ownership.soleNote')}</p>}
          </Card>
        )}
      </div>

      {dialog?.kind === 'invite' && (
        <InviteDialog
          poolId={poolId}
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onInvited={() => {
            finish('inviteSent');
          }}
        />
      )}
      {dialog?.kind === 'role' && (
        <ChangeRoleDialog
          poolId={poolId}
          member={dialog.member}
          nextRole={dialog.role}
          capabilities={capabilities}
          onClose={close}
          onDone={() => {
            finish('roleChanged');
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveMemberDialog
          poolId={poolId}
          member={dialog.member}
          onClose={close}
          onDone={() => {
            finish('removed');
          }}
        />
      )}
      {dialog?.kind === 'leave' && (
        <LeavePoolDialog
          poolId={poolId}
          poolName={poolName}
          soleOwner={soleOwner}
          onClose={close}
          onDone={() => {
            finish('left');
          }}
          onTransfer={() => {
            setDialog({ kind: 'transfer' });
          }}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferOwnershipDialog
          poolId={poolId}
          poolName={poolName}
          candidates={candidates}
          onClose={close}
          onDone={() => {
            finish('transferred');
          }}
        />
      )}
    </div>
  );
}
