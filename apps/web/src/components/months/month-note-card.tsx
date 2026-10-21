'use client';

import { Button, Card, CardHeader, formatDate } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { NoteText } from '@webapp/components/notes/note-text';
import {
  isMonthNoteDirty,
  MONTH_NOTE_MAX,
  monthNoteBody,
  monthNotePath,
  readMonthNote,
} from '@webapp/lib/month-note';
import type { MemberOption, MonthNote } from '@webapp/lib/month-types';
import { editorNameOf } from '@webapp/lib/month-view';

type Problem = 'conflict' | 'forbidden' | 'error' | null;

export interface MonthNoteCardProps {
  poolId: string;
  month: string;
  note: MonthNote;
  members: readonly MemberOption[];
  /** From the role's permissions (`notes.write`); a viewer reads the note only. */
  canWrite: boolean;
  /** Called with the saved version, so the timeline can show or hide the note dot. */
  onSaved: (note: MonthNote) => void;
}

/**
 * The note of the month, written by the household. It is saved with the version that was loaded
 * (optimistic locking): when someone saved first, the editor offers their text instead of
 * overwriting it. The text is shown as plain text, never as HTML.
 */
export function MonthNoteCard({
  poolId,
  month,
  note,
  members,
  canWrite,
  onSaved,
}: MonthNoteCardProps) {
  const t = useTranslations('months.note');
  const fieldId = useId();
  const [saved, setSaved] = useState<MonthNote>(note);
  const [text, setText] = useState(note.body ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [theirs, setTheirs] = useState<MonthNote | null>(null);

  const dirty = isMonthNoteDirty(saved.body, text);
  const editor = editorNameOf(saved.updatedBy, members) ?? t('someone');

  async function save() {
    if (busy || !canWrite) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(monthNotePath(poolId, month), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monthNoteBody(text, saved)),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { current?: unknown };
      } | null;
      if (response.ok) {
        const next = readMonthNote(body);
        if (next) {
          setSaved(next);
          setText(next.body ?? '');
          setTheirs(null);
          onSaved(next);
        }
      } else if (response.status === 409) {
        setTheirs(readMonthNote(body?.error?.current));
        setProblem('conflict');
      } else {
        setProblem(response.status === 403 ? 'forbidden' : 'error');
      }
    } catch {
      setProblem('error');
    }
    setBusy(false);
  }

  function useTheirs() {
    if (!theirs) return;
    setSaved(theirs);
    setText(theirs.body ?? '');
    setTheirs(null);
    setProblem(null);
    onSaved(theirs);
  }

  const hasText = (saved.body ?? '').trim() !== '';

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} />
      {canWrite ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="sr-only">
            {t('label')}
          </label>
          <textarea
            id={fieldId}
            name="monthNote"
            rows={6}
            maxLength={MONTH_NOTE_MAX}
            value={text}
            placeholder={t('placeholder')}
            className="w-full resize-y rounded-sm border border-line-2 bg-panel-2 p-3 text-md text-fg placeholder:text-fg-3 focus:border-accent-2 focus:outline-none"
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
          />
          <p className="text-right text-sm text-fg-3">
            {t('counter', { count: text.length, max: MONTH_NOTE_MAX })}
          </p>
        </div>
      ) : hasText ? (
        <NoteText text={saved.body ?? ''} />
      ) : (
        <p className="text-fg-3">{t('readOnlyEmpty')}</p>
      )}

      {problem === 'conflict' && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-panel-2 p-3 text-sm text-warn"
        >
          <p>{t('conflict')}</p>
          {!!theirs && (
            <Button size="sm" type="button" onClick={useTheirs}>
              {t('useTheirs')}
            </Button>
          )}
        </div>
      )}
      {problem === 'forbidden' && (
        <p role="alert" className="text-sm text-neg">
          {t('forbidden')}
        </p>
      )}
      {problem === 'error' && (
        <p role="alert" className="text-sm text-neg">
          {t('error')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {saved.updatedAt !== null && (
          <span className="mr-auto text-sm text-fg-3">
            {t('editedBy', { name: editor, date: formatDate(saved.updatedAt) })}
          </span>
        )}
        {canWrite && (
          <Button
            variant="primary"
            type="button"
            className="ml-auto"
            disabled={busy || !dirty}
            onClick={() => {
              void save();
            }}
          >
            {t('save')}
          </Button>
        )}
      </div>
    </Card>
  );
}
