import type { MonthNote } from '@webapp/lib/month-types';

/** Same limit as the API (`MONTH_NOTE_MAX`). */
export const MONTH_NOTE_MAX = 10_000;

/** The endpoint of the month note; the month is `yyyy-mm`, validated before it gets here. */
export const monthNotePath = (poolId: string, month: string): string =>
  `/api/v1/pools/${encodeURIComponent(poolId)}/months/${month}/note`;

/** The body of a save: the text typed and the version it was loaded from (`null` for no note). */
export const monthNoteBody = (text: string, loaded: MonthNote) => ({
  body: text.trim(),
  expectedUpdatedAt: loaded.updatedAt,
});

/** True when the typed text differs from the saved note (an empty text equals no note). */
export const isMonthNoteDirty = (saved: string | null, text: string): boolean =>
  (saved ?? '').trim() !== text.trim();

/** Reads the note out of a 200 answer or the `error.current` of a 409; `null` when it is neither. */
export function readMonthNote(value: unknown): MonthNote | null {
  const note = value as Partial<MonthNote> | null;
  if (
    note === null ||
    typeof note !== 'object' ||
    typeof note.month !== 'string' ||
    !(note.body === null || typeof note.body === 'string') ||
    !(note.updatedAt === null || typeof note.updatedAt === 'string')
  ) {
    return null;
  }
  return {
    month: note.month,
    id: typeof note.id === 'string' ? note.id : null,
    body: note.body,
    createdBy: typeof note.createdBy === 'string' ? note.createdBy : null,
    updatedBy: typeof note.updatedBy === 'string' ? note.updatedBy : null,
    updatedAt: note.updatedAt,
  };
}
