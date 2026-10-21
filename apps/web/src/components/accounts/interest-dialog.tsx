'use client';

import { Button, Modal } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import {
  interestBody,
  serverFields,
  validateInterest,
  type FormErrors,
  type InterestField,
  type InterestForm,
} from '@webapp/lib/account-form';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { FormRow, TextField } from './form-parts';

export interface InterestDialogProps {
  poolId: string;
  accountId: string;
  accountName: string;
  /** Today in the pool's calendar (`yyyy-mm-dd`): the date the form starts with. */
  today: string;
  onClose: () => void;
  onDone: () => void;
}

/** "Lançar juros": the net interest a savings account paid, entered by hand. */
export function InterestDialog({
  poolId,
  accountId,
  accountName,
  today,
  onClose,
  onDone,
}: InterestDialogProps) {
  const t = useTranslations('accounts.interestDialog');
  const dialog = useTranslations('accounts.dialog');
  const formId = useId();
  const uid = useId();
  const [form, setForm] = useState<InterestForm>({ date: today, amount: '' });
  const [errors, setErrors] = useState<FormErrors<InterestField>>({});
  const action = useMemberAction(onDone);
  const fromServer =
    action.problem?.status === 400 ? serverFields(action.problem.issuePaths) : null;
  const generic = action.problem !== null && action.problem.status !== 429;

  const patch = (change: Partial<InterestForm>) => {
    setForm((current) => ({ ...current, ...change }));
    action.clearProblem();
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const found = validateInterest(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void action.run(() =>
      postJson(
        `/api/v1/pools/${encodeURIComponent(poolId)}/interest`,
        interestBody(accountId, form),
      ),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('title')}
      description={t('lead', { account: accountName })}
      closeLabel={dialog('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {dialog('cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={action.busy}>
            {dialog('submit')}
          </Button>
        </>
      }
    >
      {generic && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {action.locked > 0 && (
        <LockedAlert
          title={dialog('lockedTitle')}
          text={dialog.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormRow>
          <TextField
            id={`${uid}-date`}
            label={t('date')}
            type="date"
            value={form.date}
            error={
              errors.date === 'required'
                ? t('dateRequired')
                : errors.date || fromServer?.has('date')
                  ? dialog('dateInvalid')
                  : undefined
            }
            onChange={(event) => {
              patch({ date: event.target.value });
            }}
          />
          <TextField
            id={`${uid}-amount`}
            label={t('amount')}
            inputMode="decimal"
            value={form.amount}
            error={
              errors.amount === 'required'
                ? t('amountRequired')
                : errors.amount || fromServer?.has('amount')
                  ? t('amountInvalid')
                  : undefined
            }
            onChange={(event) => {
              patch({ amount: event.target.value });
            }}
          />
        </FormRow>
      </form>
    </Modal>
  );
}
