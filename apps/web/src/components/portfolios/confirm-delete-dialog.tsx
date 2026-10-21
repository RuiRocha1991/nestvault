'use client';

import { useTranslations } from 'next-intl';

import { FormDialog } from '@webapp/components/portfolios/form-dialog';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

/** Confirms the deletion of an operation or a plan and sends the DELETE. */
export function ConfirmDeleteDialog({
  kind,
  path,
  onClose,
  onDone,
}: {
  kind: 'op' | 'plan';
  /** The REST path of the thing to delete. */
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.confirmDelete');
  const action = useMemberAction(onDone);

  return (
    <FormDialog
      title={t(`${kind}Title`)}
      submitLabel={t('confirm')}
      destructive
      action={action}
      onClose={onClose}
      onSubmit={() => {
        void action.run(() => sendJson('DELETE', path));
      }}
    >
      <p className="text-md text-fg-2">{t(`${kind}Text`)}</p>
    </FormDialog>
  );
}
