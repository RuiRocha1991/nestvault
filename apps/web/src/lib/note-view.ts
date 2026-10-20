/** What a movement note is, as the editor needs it. Mirrors `NoteDto` of the notes API. */
export interface NoteState {
  note: string | null;
  noteUpdatedBy: string | null;
  noteUpdatedAt: string | null;
}

export type NoteKind = 'transaction' | 'operation';

/** Same limit as the API (`TRANSACTION_NOTE_MAX`). */
export const NOTE_MAX = 2000;

/** The endpoint that sets or clears the note of a movement; ids are path segments, so encoded. */
export function notePath(poolId: string, kind: NoteKind, id: string): string {
  const resource = kind === 'transaction' ? 'transactions' : 'ops';
  return `/api/v1/pools/${encodeURIComponent(poolId)}/${resource}/${encodeURIComponent(id)}/note`;
}

/** The first non-empty line, for the indicator tooltip. */
export function firstLine(note: string): string {
  return (
    note
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** The body to send: what was typed, trimmed; nothing at all clears the note. */
export function noteBody(text: string): { note: string | null } {
  const trimmed = text.trim();
  return { note: trimmed === '' ? null : trimmed };
}

/** True when the typed text differs from the saved note (an empty text equals no note). */
export function isDirty(saved: string | null, text: string): boolean {
  return (saved ?? '').trim() !== text.trim();
}

/** `N` on a focused row opens its note; typing `n` in a field must not. */
export function isNoteHotkey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.key.toLowerCase() !== 'n' || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = target?.tagName?.toLowerCase();
  return tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !target?.isContentEditable;
}

/** `Ctrl/Cmd+Enter` saves from inside the textarea. */
export function isSaveShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}
