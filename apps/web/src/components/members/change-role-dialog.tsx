'use client';

import { Button, Chip, Modal } from '@nestvault/ui';
import { ArrowRight, Check, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert } from '@webapp/components/auth/alert';
import type { MemberView, RoleCapabilities, RoleName } from '@webapp/lib/members-view';
import { sendJson } from '@webapp/lib/post-json';
import { diffCapabilities, type Capability } from '@webapp/lib/role-capabilities';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { DialogProblem } from './dialog-problem';
import { MemberAvatar } from './member-avatar';

export interface ChangeRoleDialogProps {
  poolId: string;
  member: MemberView;
  nextRole: RoleName;
  capabilities: RoleCapabilities;
  onClose: () => void;
  onDone: () => void;
}

function CapabilityList({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly Capability[];
  tone: 'pos' | 'neg';
}) {
  const t = useTranslations('members');
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-semibold text-fg-2">{title}</h3>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-fg-3">{t('changeRole.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {items.map((item) => (
            <li
              key={item}
              className={tone === 'pos' ? 'flex gap-2 text-pos' : 'flex gap-2 text-neg'}
            >
              {tone === 'pos' ? (
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              )}
              {t(`capabilities.${item}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Modal 75: what the person keeps and loses with the new role, and that their session ends. */
export function ChangeRoleDialog({
  poolId,
  member,
  nextRole,
  capabilities,
  onClose,
  onDone,
}: ChangeRoleDialogProps) {
  const t = useTranslations('members');
  const tRoles = useTranslations('pools.roles');
  const action = useMemberAction(onDone);
  const { keep, lose, gain } = diffCapabilities(capabilities[member.role], capabilities[nextRole]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('changeRole.title', { name: member.name })}
      closeLabel={t('dialog.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={action.busy}
            onClick={() => {
              void action.run(() =>
                sendJson(
                  'PATCH',
                  `/api/v1/pools/${encodeURIComponent(poolId)}/members/${encodeURIComponent(member.id)}`,
                  { role: nextRole },
                ),
              );
            }}
          >
            {t('changeRole.submit')}
          </Button>
        </>
      }
    >
      <DialogProblem problem={action.problem} locked={action.locked} />
      <div className="flex items-center gap-3 rounded-md bg-bg px-3.5 py-3">
        <MemberAvatar id={member.id} name={member.name} />
        <div className="mr-auto min-w-0">
          <div className="font-semibold">{member.name}</div>
          {!!member.email && <div className="truncate text-sm text-fg-3">{member.email}</div>}
        </div>
        <Chip>{tRoles(member.role)}</Chip>
        <ArrowRight aria-hidden className="size-4 text-fg-3" />
        <Chip tone="accent">{tRoles(nextRole)}</Chip>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CapabilityList title={t('changeRole.keeps')} items={keep} tone="pos" />
        <CapabilityList title={t('changeRole.loses')} items={lose} tone="neg" />
      </div>
      {gain.length > 0 && <CapabilityList title={t('changeRole.gains')} items={gain} tone="pos" />}
      <Alert tone="info" icon={<Info aria-hidden />}>
        <span className="text-fg-2">{t('changeRole.sessionNote', { name: member.name })}</span>
      </Alert>
    </Modal>
  );
}
