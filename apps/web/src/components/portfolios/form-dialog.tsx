'use client';

import { Button, Modal } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import type { ApiProblem } from '@webapp/lib/members-api';

export interface FormActionState {
  busy: boolean;
  problem: ApiProblem | null;
  locked: number;
}

/** The textarea of the dialogs, styled like the note editor's. */
export const textareaClass =
  'w-full resize-y rounded-sm border border-line-2 bg-inset p-2.5 text-base text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none';

export interface FormDialogProps {
  title: string;
  submitLabel: string;
  action: FormActionState;
  /** The server answered 4xx for a field of the form: the message the dialog shows for it. */
  fieldProblem?: string | null | undefined;
  onClose: () => void;
  onSubmit: () => void;
  /** `destructive` for the delete confirmations. */
  destructive?: boolean;
  wide?: boolean | undefined;
  /** Footer content on the left of Cancel (e.g. a delete link). */
  footerStart?: ReactNode;
  children: ReactNode;
}

/** The shell of every Portfolios dialog: modal, submit on Enter, and the banners of a failed save. */
export function FormDialog({
  title,
  submitLabel,
  action,
  fieldProblem,
  onClose,
  onSubmit,
  destructive = false,
  wide,
  footerStart,
  children,
}: FormDialogProps) {
  const t = useTranslations('portfolios.dialog');
  const formId = useId();
  const forbidden = action.problem?.status === 403;
  const conflict = action.problem?.status === 409;
  const generic = action.problem !== null && action.problem.status !== 429;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action.busy) onSubmit();
  }

  return (
    <Modal
      open
      {...(wide ? { wide } : {})}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      closeLabel={t('close')}
      footer={
        <>
          {footerStart}
          <span className="mr-auto" />
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={destructive ? 'destructive' : 'primary'}
            disabled={action.busy}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {generic && (
        <ProblemAlert
          title={t('errorTitle')}
          text={
            forbidden
              ? t('forbidden')
              : conflict
                ? (fieldProblem ?? t('conflict'))
                : (fieldProblem ?? t('errorText'))
          }
        />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {children}
      </form>
    </Modal>
  );
}
