'use client';

import { Button, Input, Modal, Select } from '@nestvault/ui';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';
import '@webapp/lib/zod-csp';

/** The roles an invite offers in the dialog (an owner is made by transferring ownership). */
const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

const EMAIL = z.email().max(254);

export interface InviteDialogProps {
  poolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the server accepted the invite, so the pending list can reload. */
  onInvited?: () => void;
}

/**
 * Modal 66: email and role. The server decides who may invite and with which role (`members.invite`,
 * never above the inviter's own); the body carries only the email and the role, never the pool.
 */
export function InviteDialog({ poolId, open, onOpenChange, onInvited }: InviteDialogProps) {
  const t = useTranslations('invite.dialog');
  const tRoles = useTranslations('pools.roles');
  const ids = { form: useId(), email: useId(), role: useId() };
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('viewer');
  const [invalid, setInvalid] = useState(false);
  const action = useMemberAction(() => {
    onInvited?.();
    close(false);
  });

  // 429 is the pause banner, not a problem of its own; 409 and 400 belong to the email field.
  const failed = action.problem?.status === 429 ? null : action.problem;
  const problem = invalid
    ? 'email'
    : failed?.status === 409
      ? 'member'
      : failed?.status === 400
        ? 'email'
        : failed
          ? 'error'
          : null;

  function close(next: boolean) {
    if (!next) {
      setEmail('');
      setRole('viewer');
      setInvalid(false);
      action.clearProblem();
    }
    onOpenChange(next);
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const parsed = EMAIL.safeParse(email.trim());
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    void action.run(() =>
      postJson(`/api/v1/pools/${encodeURIComponent(poolId)}/invites`, {
        email: parsed.data,
        role,
      }),
    );
  }

  const emailProblem = problem === 'email' || problem === 'member';

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              close(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={action.busy}>
            <Mail aria-hidden />
            {t('submit')}
          </Button>
        </>
      }
    >
      {problem === 'error' && <ProblemAlert title={t('errorTitle')} text={t('errorText')} />}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      <form id={ids.form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.email} className="text-sm font-medium text-fg-2">
            {t('email')}
          </label>
          <Input
            id={ids.email}
            name="email"
            type="email"
            autoComplete="off"
            maxLength={254}
            required
            placeholder={t('emailPlaceholder')}
            value={email}
            aria-invalid={emailProblem}
            onChange={(event) => {
              setEmail(event.target.value);
              setInvalid(false);
              action.clearProblem();
            }}
          />
          {emailProblem ? (
            <p role="alert" className="text-sm text-neg">
              {problem === 'member' ? t('alreadyMember') : t('invalidEmail')}
            </p>
          ) : (
            <p className="text-sm text-fg-3">{t('emailHint')}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.role} className="text-sm font-medium text-fg-2">
            {t('role')}
          </label>
          <Select
            id={ids.role}
            name="role"
            value={role}
            onChange={(event) => {
              setRole(INVITE_ROLES.find((option) => option === event.target.value) ?? 'viewer');
            }}
          >
            {INVITE_ROLES.map((option) => (
              <option key={option} value={option}>
                {tRoles(option)}
              </option>
            ))}
          </Select>
        </div>

        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {INVITE_ROLES.map((option) => (
            <div key={option} className="contents">
              <dt className="font-semibold">{tRoles(option)}</dt>
              <dd className="m-0 text-right text-fg-3">{t(`roleHint.${option}`)}</dd>
            </div>
          ))}
        </dl>

        <p className="rounded-md bg-bg px-3 py-2.5 text-sm text-fg-2">
          {t.rich('note', { b: (chunks) => <b>{chunks}</b> })}
        </p>
      </form>
    </Modal>
  );
}
