'use client';

import { Button, Modal } from '@nestvault/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

export type DeleteTarget =
  { kind: 'account'; id: string; name: string } | { kind: 'product'; id: string; name: string };

/** Asks before deleting an account or a savings product; the server answers 409 while in use. */
export function DeleteDialog({
  poolId,
  target,
  onClose,
  onDone,
}: {
  poolId: string;
  target: DeleteTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('accounts.deleteDialog');
  const dialog = useTranslations('accounts.dialog');
  const action = useMemberAction(onDone);
  const inUse = action.problem?.status === 409;
  const resource = target.kind === 'account' ? 'accounts' : 'products';

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={target.kind === 'account' ? t('accountTitle') : t('productTitle')}
      closeLabel={dialog('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {dialog('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={action.busy}
            onClick={() => {
              void action.run(() =>
                sendJson(
                  'DELETE',
                  `/api/v1/pools/${encodeURIComponent(poolId)}/${resource}/${encodeURIComponent(target.id)}`,
                ),
              );
            }}
          >
            <Trash2 aria-hidden />
            {t('submit')}
          </Button>
        </>
      }
    >
      {action.problem !== null && action.problem.status !== 429 && (
        <ProblemAlert title={t('errorTitle')} text={inUse ? t('conflictText') : t('errorText')} />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={dialog('lockedTitle')}
          text={dialog.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <p className="m-0 text-md">
        {target.kind === 'account'
          ? t('accountText', { name: target.name })
          : t('productText', { name: target.name })}
      </p>
    </Modal>
  );
}
