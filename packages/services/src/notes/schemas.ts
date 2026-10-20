import type { MonthNoteRow, NoteState } from '@nestvault/db';
import { z } from 'zod';

export const TRANSACTION_NOTE_MAX = 2000;
export const MONTH_NOTE_MAX = 10000;
/** The longest range `GET /months` answers, in months. */
export const MONTH_RANGE_MAX = 120;

// Notes are free text typed by people: line breaks and tabs are fine, other control characters are not.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NOTE_CHARS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

/** `yyyy-mm`, month 01 to 12. */
export const MonthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Trimmed text; an empty one (or `null`) clears the note. */
const noteText = (max: number) => z.string().trim().max(max).regex(NOTE_CHARS);

/** `.strict()`: ids, authors and times never come from the body. */
export const SetNoteInput = z.object({ note: noteText(TRANSACTION_NOTE_MAX).nullable() }).strict();
export type SetNoteInput = z.input<typeof SetNoteInput>;

/**
 * `expectedUpdatedAt` is the `updatedAt` of the version the editor loaded (`null` when the month had
 * no note). A different current version answers 409 with that version. An empty `body` clears.
 */
export const PutMonthNoteInput = z
  .object({
    body: noteText(MONTH_NOTE_MAX),
    expectedUpdatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PutMonthNoteInput = z.input<typeof PutMonthNoteInput>;

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

export const ListMonthsQuery = z
  .object({ from: MonthParam, to: MonthParam })
  .strict()
  .refine((value) => value.from <= value.to)
  .refine((value) => monthIndex(value.to) - monthIndex(value.from) < MONTH_RANGE_MAX);
export type ListMonthsQuery = z.input<typeof ListMonthsQuery>;

export const NoteDto = z.object({
  id: z.uuid(),
  note: z.string().nullable(),
  noteUpdatedBy: z.uuid().nullable(),
  noteUpdatedAt: z.iso.datetime().nullable(),
});
export type NoteDto = z.infer<typeof NoteDto>;

export const toNoteDto = (state: NoteState): NoteDto => ({
  id: state.id,
  note: state.note,
  noteUpdatedBy: state.noteUpdatedBy,
  noteUpdatedAt: state.noteUpdatedAt ? state.noteUpdatedAt.toISOString() : null,
});

/** A month's note; everything but `month` is null while the month has none. */
export const MonthNoteDto = z.object({
  month: MonthParam,
  id: z.uuid().nullable(),
  body: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  /** The version: send it back as `expectedUpdatedAt`. */
  updatedAt: z.iso.datetime().nullable(),
});
export type MonthNoteDto = z.infer<typeof MonthNoteDto>;

export const MonthNoteListDto = z.object({ months: z.array(MonthNoteDto) });
export type MonthNoteListDto = z.infer<typeof MonthNoteListDto>;

export const emptyMonthNote = (month: string): MonthNoteDto => ({
  month,
  id: null,
  body: null,
  createdBy: null,
  updatedBy: null,
  updatedAt: null,
});

export const toMonthNoteDto = (row: MonthNoteRow): MonthNoteDto => ({
  month: row.month.slice(0, 7),
  id: row.id,
  body: row.body,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt.toISOString(),
});
