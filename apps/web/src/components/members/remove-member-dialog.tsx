'use client';

import { Button, Modal } from '@nestvault/ui';
import { Check, Lock, Trash2, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MemberView } from '@webapp/lib/members-view';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { DialogProblem } from './dialog-problem';
import { MemberAvatar } from './member-avatar';

export interface RemoveMemberDialogProps {
  poolId: string;
  member: MemberView;
  onClose: () => void;
  onDone: () => void;
}

/** Modal 74: what removing a person does (access lost at once, data kept, they stay a holder). */
export function RemoveMemberDialog({ poolId, member, onClose, onDone }: RemoveMemberDialogProps) {
  const t = useTranslations('members');
  const tRoles = useTranslations('pools.roles');
  const action = useMemberAction(onDone);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('removeMember.title', { name: member.name })}
      closeLabel={t('dialog.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            disabled={action.busy}
            variant="destructive"
            onClick={() => {
              void action.run(() =>
                sendJson(
                  'DELETE',
                  `/api/v1/pools/${encodeURIComponent(poolId)}/members/${encodeURIComponent(member.id)}`,
                ),
              );
            }}
          >
            <Trash2 aria-hidden />
            {t('removeMember.submit')}
          </Button>
        </>
      }
    >
      <DialogProblem problem={action.problem} locked={action.locked} />
      <div className="flex items-center gap-3 rounded-md bg-bg px-3.5 py-3">
        <MemberAvatar id={member.id} name={member.name} />
        <div className="min-w-0">
          <div className="font-semibold">{member.name}</div>
          <div className="truncate text-sm text-fg-3">
            {[member.email, tRoles(member.role)].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md">
        <li className="flex gap-2.5">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
          {t('removeMember.access')}
        </li>
        <li className="flex gap-2.5">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
          {t('removeMember.data')}
        </li>
        <li className="flex gap-2.5">
          <User aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
          {t('removeMember.holder', { name: member.name })}
        </li>
      </ul>
      <p className="m-0 text-sm text-fg-3">{t('removeMember.audit')}</p>
    </Modal>
  );
}
