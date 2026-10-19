'use client';

import { Button, Modal } from '@nestvault/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import type { HolderView } from './holder-dialog';

/** Asks before removing a person; the server answers 409 while accounts still name them. */
export function DeleteHolderDialog({
  poolId,
  holder,
  onClose,
  onDone,
}: {
  poolId: string;
  holder: HolderView;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('holders.delete');
  const action = useMemberAction(onDone);
  const inUse = action.problem?.status === 409;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('title', { name: holder.name })}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={action.busy}
            variant="destructive"
            onClick={() => {
              void action.run(() =>
                sendJson(
                  'DELETE',
                  `/api/v1/pools/${encodeURIComponent(poolId)}/holders/${encodeURIComponent(holder.id)}`,
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
        <ProblemAlert title={t('errorTitle')} text={inUse ? t('inUse') : t('errorText')} />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <p className="m-0 text-md">{t('text')}</p>
    </Modal>
  );
}
