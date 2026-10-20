'use client';

import { Button, formatDate, Sheet } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Countdown, LockedAlert, ProblemAlert } from '@webapp/components/auth/alert';
import { NoteText } from '@webapp/components/notes/note-text';
import {
  isDirty,
  isSaveShortcut,
  noteBody,
  notePath,
  NOTE_MAX,
  type NoteKind,
  type NoteState,
} from '@webapp/lib/note-view';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

export interface NoteSheetProps {
  poolId: string;
  kind: NoteKind;
  /** The transaction or investment operation. */
  id: string;
  note: NoteState;
  /** The name of whoever last edited the note; the caller resolves it from `noteUpdatedBy`. */
  editorName: string | null;
  /** From the role's permissions (`notes.write`); a viewer sees the note read-only. */
  canWrite: boolean;
  /** The movement's details (date, description, amount), formatted by the table that opens this. */
  details: ReactNode;
  onClose: () => void;
  /** The saved state, so the table updates its indicator without a reload. */
  onSaved: (next: NoteState) => void;
}

/**
 * Side panel (desktop) / bottom sheet (mobile) with a movement's note. The body carries only the
 * text: the movement comes from the URL and the server decides who may write (`notes.write`).
 * The note is shown as plain text, never as HTML.
 */
export function NoteSheet({
  poolId,
  kind,
  id,
  note,
  editorName,
  canWrite,
  details,
  onClose,
  onSaved,
}: NoteSheetProps) {
  const t = useTranslations('notes');
  const ids = { field: useId(), count: useId() };
  const [text, setText] = useState(note.note ?? '');
  const [saved, setSaved] = useState<NoteState>(note);
  // `useMemberAction` has no result channel: the request parks the saved state here for `onDone`.
  const result = useRef<NoteState | null>(null);
  const action = useMemberAction(() => {
    if (result.current !== null) {
      setSaved(result.current);
      onSaved(result.current);
    }
    onClose();
  });

  const hasNote = saved.note !== null;
  const hasText = (saved.note ?? '').trim() !== '';
  const dirty = isDirty(saved.note, text);
  const generic = action.problem !== null && action.problem.status !== 429;
  const forbidden = action.problem?.status === 403;

  function save(next: string) {
    if (action.busy || !canWrite) return;
    void action.run(async () => {
      const response = await sendJson('PATCH', notePath(poolId, kind, id), noteBody(next));
      if (response.ok) {
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as Partial<NoteState> | null;
        result.current = {
          note: typeof body?.note === 'string' ? body.note : null,
          noteUpdatedBy: typeof body?.noteUpdatedBy === 'string' ? body.noteUpdatedBy : null,
          noteUpdatedAt: typeof body?.noteUpdatedAt === 'string' ? body.noteUpdatedAt : null,
        };
      }
      return response;
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSaveShortcut(event)) {
      event.preventDefault();
      if (dirty) save(text);
    }
  }

  const readOnly = hasText ? (
    <NoteText text={saved.note ?? ''} />
  ) : (
    <p className="text-fg-3">{t('readOnlyEmpty')}</p>
  );

  const edited =
    saved.noteUpdatedAt !== null &&
    t('editedBy', {
      name: editorName ?? t('someone'),
      date: formatDate(saved.noteUpdatedAt),
    });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        canWrite ? (
          <>
            {hasNote && (
              <Button
                variant="danger"
                type="button"
                className="mr-auto"
                disabled={action.busy}
                onClick={() => {
                  save('');
                }}
              >
                {t('delete')}
              </Button>
            )}
            <Button variant="ghost" type="button" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={action.busy || !dirty}
              onClick={() => {
                save(text);
              }}
            >
              {t('save')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('close')}
          </Button>
        )
      }
    >
      <div className="rounded-md border border-line bg-panel-2 p-3 text-sm">{details}</div>
      {generic && (
        <ProblemAlert title={t('errorTitle')} text={forbidden ? t('forbidden') : t('errorText')} />
      )}
      {action.locked > 0 && (
        <LockedAlert
          title={t('lockedTitle')}
          text={t.rich('lockedText', { time: () => <Countdown seconds={action.locked} /> })}
        />
      )}
      {canWrite ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.field} className="text-sm font-medium text-fg-2">
            {t('label')}
          </label>
          <textarea
            id={ids.field}
            name="note"
            rows={6}
            maxLength={NOTE_MAX}
            value={text}
            placeholder={t('placeholder')}
            aria-describedby={ids.count}
            className="w-full resize-y rounded-sm border border-line-2 bg-panel-2 p-3 text-md text-fg placeholder:text-fg-3 focus:border-accent-2 focus:outline-none"
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setText(event.target.value);
              action.clearProblem();
            }}
          />
          <p id={ids.count} className="text-right text-sm text-fg-3">
            {t('counter', { count: text.length, max: NOTE_MAX })}
          </p>
        </div>
      ) : (
        readOnly
      )}
      {!!edited && <p className="text-sm text-fg-3">{edited}</p>}
    </Sheet>
  );
}
