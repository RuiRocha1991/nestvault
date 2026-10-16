'use client';

import { Button, Modal } from '@nestvault/ui';
import { ArrowLeftRight, Check, LogOut, Mail, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert } from '@webapp/components/auth/alert';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { DialogProblem } from './dialog-problem';

export interface LeavePoolDialogProps {
  poolId: string;
  poolName: string;
  /** The caller is the pool's only owner: leaving is refused and the dialog offers the transfer. */
  soleOwner: boolean;
  onClose: () => void;
  onDone: () => void;
  onTransfer: () => void;
}

/** Modals 72 (leave) and 73 (blocked for the last owner, with a shortcut to transfer ownership). */
export function LeavePoolDialog({
  poolId,
  poolName,
  soleOwner,
  onClose,
  onDone,
  onTransfer,
}: LeavePoolDialogProps) {
  const t = useTranslations('members');
  const action = useMemberAction(onDone);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('leavePool.title')}
      closeLabel={t('dialog.close')}
      footer={
        soleOwner ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('leaveBlocked.close')}
            </Button>
            <Button variant="primary" onClick={onTransfer}>
              <ArrowLeftRight aria-hidden />
              {t('leaveBlocked.transfer')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={action.busy}
              onClick={() => {
                void action.run(() =>
                  postJson(`/api/v1/pools/${encodeURIComponent(poolId)}/leave`, undefined),
                );
              }}
            >
              <LogOut aria-hidden />
              {t('leavePool.submit')}
            </Button>
          </>
        )
      }
    >
      {soleOwner ? (
        <Alert tone="warning" icon={<TriangleAlert aria-hidden />}>
          <b>{t('leaveBlocked.title', { pool: poolName })}</b>
          <br />
          <span className="text-fg-2">{t('leaveBlocked.text')}</span>
        </Alert>
      ) : (
        <>
          <DialogProblem problem={action.problem} locked={action.locked} />
          <p className="m-0 text-md text-fg-2">
            {t.rich('leavePool.lead', {
              pool: poolName,
              b: (chunks) => <b className="text-fg">{chunks}</b>,
            })}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md">
            <li className="flex gap-2.5">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
              {t('leavePool.data')}
            </li>
            <li className="flex gap-2.5">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
              {t('leavePool.account')}
            </li>
            <li className="flex gap-2.5">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" />
              {t('leavePool.reinvite')}
            </li>
          </ul>
        </>
      )}
    </Modal>
  );
}
