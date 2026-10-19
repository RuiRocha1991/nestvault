'use client';

import { Button, Input, Modal } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { postJson, sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

export interface HolderView {
  id: string;
  name: string;
  color: string;
  aliases: readonly string[];
  /** A current member of the pool: always listed, cannot be removed here. */
  member: boolean;
}

export interface HolderDialogProps {
  poolId: string;
  /** The person being edited; absent when adding one. */
  holder?: HolderView;
  /** The colour a new person starts with (the next unused one of the palette). */
  suggestedColor: string;
  onClose: () => void;
  onDone: () => void;
}

/** Splits "RUI GUILHERME, R G ROCHA" into aliases; the server normalizes and validates them. */
const splitAliases = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/**
 * Modal 26: name, colour and how the person appears in bank statements. The body carries only
 * those fields: the pool comes from the URL and the server decides who may write (`accounts.write`).
 */
export function HolderDialog({
  poolId,
  holder,
  suggestedColor,
  onClose,
  onDone,
}: HolderDialogProps) {
  const t = useTranslations('holders.dialog');
  const ids = { form: useId(), name: useId(), color: useId(), aliases: useId() };
  const [name, setName] = useState(holder?.name ?? '');
  const [color, setColor] = useState(holder?.color ?? suggestedColor);
  const [aliases, setAliases] = useState(holder?.aliases.join(', ') ?? '');
  const [empty, setEmpty] = useState(false);
  const action = useMemberAction(onDone);

  const badAliases = action.problem?.status === 400 && action.problem.issuePaths.length > 0;
  const generic = action.problem !== null && action.problem.status !== 429 && !badAliases;

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    setEmpty(name.trim() === '');
    if (name.trim() === '') return;
    const body = { name: name.trim(), color, aliases: splitAliases(aliases) };
    const base = `/api/v1/pools/${encodeURIComponent(poolId)}/holders`;
    void action.run(() =>
      holder
        ? sendJson('PATCH', `${base}/${encodeURIComponent(holder.id)}`, body)
        : postJson(base, body),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={holder ? t('editTitle') : t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={action.busy}>
            {t('submit')}
          </Button>
        </>
      }
    >
      {generic && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-sm font-medium text-fg-2">
              {t('name')}
            </label>
            <Input
              id={ids.name}
              name="name"
              autoComplete="off"
              maxLength={60}
              required
              value={name}
              aria-invalid={empty}
              onChange={(event) => {
                setName(event.target.value);
                setEmpty(false);
                action.clearProblem();
              }}
            />
            {empty && (
              <p role="alert" className="text-sm text-neg">
                {t('nameRequired')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.color} className="text-sm font-medium text-fg-2">
              {t('color')}
            </label>
            <Input
              id={ids.color}
              name="color"
              type="color"
              className="h-10 w-24 p-1"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.aliases} className="text-sm font-medium text-fg-2">
            {t('aliases')}
          </label>
          <Input
            id={ids.aliases}
            name="aliases"
            autoComplete="off"
            placeholder={t('aliasesPlaceholder')}
            value={aliases}
            aria-invalid={badAliases}
            onChange={(event) => {
              setAliases(event.target.value);
              action.clearProblem();
            }}
          />
          <p className={badAliases ? 'text-sm text-neg' : 'text-sm text-fg-3'}>
            {badAliases ? t('aliasesInvalid') : t('aliasesHint')}
          </p>
        </div>
      </form>
    </Modal>
  );
}
