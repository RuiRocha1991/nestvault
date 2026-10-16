'use client';

import { Button, Input, Modal, Select } from '@nestvault/ui';
import { ArrowLeftRight, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Alert } from '@webapp/components/auth/alert';
import { transferBody } from '@webapp/lib/members-api';
import type { MemberView } from '@webapp/lib/members-view';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { DialogProblem } from './dialog-problem';

export interface TransferOwnershipDialogProps {
  poolId: string;
  poolName: string;
  /** The members who can receive the pool: everybody but the caller and the other owners. */
  candidates: readonly MemberView[];
  onClose: () => void;
  onDone: () => void;
}

/** Modal 67: pick the new owner and confirm with the caller's password; the caller becomes admin. */
export function TransferOwnershipDialog({
  poolId,
  poolName,
  candidates,
  onClose,
  onDone,
}: TransferOwnershipDialogProps) {
  const t = useTranslations('members');
  const ids = { form: useId(), target: useId(), password: useId(), keep: useId() };
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(false);
  const action = useMemberAction(onDone);
  const wrongPassword = action.problem?.issuePaths.includes('password') === true;
  const ready = target !== '' && password !== '' && !action.busy;

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    void action.run(() =>
      postJson(
        `/api/v1/pools/${encodeURIComponent(poolId)}/transfer`,
        transferBody({ userId: target, password, keepOwnership: keep }),
      ),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('transfer.title')}
      closeLabel={t('dialog.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={!ready}>
            <ArrowLeftRight aria-hidden />
            {t('transfer.submit')}
          </Button>
        </>
      }
    >
      <DialogProblem problem={action.problem} locked={action.locked} hiddenPaths={['password']} />
      <p className="m-0 text-md text-fg-2">
        {t.rich('transfer.lead', {
          pool: poolName,
          b: (chunks) => <b className="text-fg">{chunks}</b>,
        })}
      </p>
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.target} className="text-sm font-medium text-fg-2">
            {t('transfer.target')}
          </label>
          <Select
            id={ids.target}
            name="target"
            value={target}
            disabled={candidates.length === 0}
            onChange={(event) => {
              setTarget(event.target.value);
              action.clearProblem();
            }}
          >
            <option value="">{t('transfer.targetPlaceholder')}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.email ? `${candidate.name} (${candidate.email})` : candidate.name}
              </option>
            ))}
          </Select>
          {candidates.length === 0 && (
            <p className="text-sm text-fg-3">{t('transfer.noTargets')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.password} className="text-sm font-medium text-fg-2">
            {t('transfer.password')}
          </label>
          <Input
            id={ids.password}
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            aria-invalid={wrongPassword}
            onChange={(event) => {
              setPassword(event.target.value);
              action.clearProblem();
            }}
          />
          {wrongPassword && (
            <p role="alert" className="text-sm text-neg">
              {t('transfer.wrongPassword')}
            </p>
          )}
        </div>
        <div className="flex items-start gap-2.5">
          <input
            id={ids.keep}
            name="keepOwnership"
            type="checkbox"
            checked={keep}
            className="mt-0.5 size-4 accent-accent"
            onChange={(event) => {
              setKeep(event.target.checked);
            }}
          />
          <label htmlFor={ids.keep} className="flex flex-col text-md">
            {t('transfer.keep')}
            <span className="text-sm text-fg-3">{t('transfer.keepHint')}</span>
          </label>
        </div>
      </form>
      <Alert tone="warning" icon={<TriangleAlert aria-hidden />}>
        <span className="text-fg-2">
          {t.rich(keep ? 'transfer.warningKeep' : 'transfer.warning', {
            b: (chunks) => <b className="text-warn">{chunks}</b>,
          })}
        </span>
      </Alert>
    </Modal>
  );
}
