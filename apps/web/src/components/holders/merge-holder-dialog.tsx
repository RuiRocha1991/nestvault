'use client';

import { Button, Chip, Modal, Select } from '@nestvault/ui';
import { Merge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import type { HolderView } from './holder-dialog';

interface Preview {
  accounts: number;
  subAccounts: number;
  addedAliases: string[];
  tooManyAliases: boolean;
}

export interface MergeHolderDialogProps {
  poolId: string;
  /** The person added by hand that disappears. */
  holder: HolderView;
  /** The people it can be joined into (everybody else); the target keeps its name. */
  targets: readonly HolderView[];
  /** The target chosen when the dialog opens (the suggestion), if any. */
  initialTargetId?: string;
  onClose: () => void;
  onDone: () => void;
}

/** Asks which person to join with, shows what moves, then confirms; the server decides everything. */
export function MergeHolderDialog({
  poolId,
  holder,
  targets,
  initialTargetId = '',
  onClose,
  onDone,
}: MergeHolderDialogProps) {
  const t = useTranslations('holders.merge');
  const targetId = useId();
  const [target, setTarget] = useState(initialTargetId);
  const [preview, setPreview] = useState<Preview | 'failed' | null>(null);
  const action = useMemberAction(onDone);
  const base = `/api/v1/pools/${encodeURIComponent(poolId)}/holders/${encodeURIComponent(holder.id)}/merge`;
  const chosen = targets.find((one) => one.id === target);

  useEffect(() => {
    if (target === '') return;
    const abort = new AbortController();
    fetch(`${base}?intoId=${encodeURIComponent(target)}`, {
      credentials: 'same-origin',
      signal: abort.signal,
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as Preview) : ('failed' as const),
      )
      .then(setPreview)
      .catch(() => {
        if (!abort.signal.aborted) setPreview('failed');
      });
    return () => {
      abort.abort();
    };
  }, [base, target]);

  const tooMany = preview !== null && preview !== 'failed' && preview.tooManyAliases;
  const ready = preview !== null && preview !== 'failed' && !tooMany;

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
            variant="primary"
            disabled={action.busy || !ready}
            onClick={() => {
              void action.run(() => postJson(base, { intoId: target }));
            }}
          >
            <Merge aria-hidden />
            {t('submit')}
          </Button>
        </>
      }
    >
      {action.problem !== null && action.problem.status !== 429 && (
        <ProblemAlert
          title={t('errorTitle')}
          text={action.problem.status === 409 ? t('tooManyAliases') : t('errorText')}
        />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <p className="m-0 text-md text-fg-2">{t('lead', { name: holder.name })}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={targetId} className="text-sm font-medium text-fg-2">
          {t('target')}
        </label>
        <Select
          id={targetId}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setPreview(null);
            action.clearProblem();
          }}
        >
          <option value="">{t('targetPlaceholder')}</option>
          {targets.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </Select>
      </div>
      {chosen && preview === 'failed' && (
        <p className="m-0 text-sm text-neg">{t('previewFailed')}</p>
      )}
      {chosen && preview !== null && preview !== 'failed' && (
        <div className="flex flex-col gap-2 text-md">
          <p className="m-0">
            {t('moves', { accounts: preview.accounts, subAccounts: preview.subAccounts })}
          </p>
          {preview.addedAliases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-fg-2">{t('addedAliases')}</span>
              {preview.addedAliases.map((alias) => (
                <Chip key={alias}>{alias}</Chip>
              ))}
            </div>
          )}
          <p className="m-0 text-fg-2">{t('keepsName', { name: chosen.name })}</p>
          {tooMany && <p className="m-0 text-sm text-neg">{t('tooManyAliases')}</p>}
        </div>
      )}
    </Modal>
  );
}
