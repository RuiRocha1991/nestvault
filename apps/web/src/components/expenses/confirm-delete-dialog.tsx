'use client';

import { Button, Modal } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { ExpenseProblem } from './expense-problem';

export interface ConfirmDeleteDialogProps {
  title: string;
  text: string;
  confirmLabel: string;
  /** The endpoint to send DELETE to (ids already encoded by the caller). */
  path: string;
  onClose: () => void;
  onDone: () => void;
}

/** The confirmation of a delete (a movement, a rule): one request, the problem shown in the dialog. */
export function ConfirmDeleteDialog({
  title,
  text,
  confirmLabel,
  path,
  onClose,
  onDone,
}: ConfirmDeleteDialogProps) {
  const t = useTranslations('expenses');
  const action = useMemberAction(onDone);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={action.busy}
            onClick={() => {
              void action.run(() => sendJson('DELETE', path));
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <ExpenseProblem problem={action.problem} locked={action.locked} />
      <p className="m-0 text-fg-2">{text}</p>
    </Modal>
  );
}
