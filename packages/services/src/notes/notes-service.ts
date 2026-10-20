import {
  monthNotesRepo,
  newId,
  notesRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { parseId } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';

import {
  emptyMonthNote,
  ListMonthsQuery,
  MonthNoteDto,
  MonthNoteListDto,
  MonthParam,
  NoteDto,
  PutMonthNoteInput,
  SetNoteInput,
  toMonthNoteDto,
  toNoteDto,
} from './schemas';

export interface NotesService {
  /** Sets the note of a movement; an empty one or `null` clears it (`notes.write`). */
  setTransactionNote(
    headers: Headers,
    poolId: string,
    id: string,
    input: unknown,
  ): Promise<NoteDto>;
  /** Same for an investment operation (`notes.write`). */
  setOperationNote(headers: Headers, poolId: string, id: string, input: unknown): Promise<NoteDto>;
  /** The note of a month (`yyyy-mm`); empty fields while there is none (any member). */
  getMonthNote(headers: Headers, poolId: string, month: string): Promise<MonthNoteDto>;
  /**
   * Writes the note of a month with optimistic locking (`notes.write`). The caller sends the
   * version it loaded; if someone else saved first the answer is 409 carrying the current version.
   */
  putMonthNote(
    headers: Headers,
    poolId: string,
    month: string,
    input: unknown,
  ): Promise<MonthNoteDto>;
  /** The notes of the months in `from`..`to` (`yyyy-mm`, at most 120 months), oldest first (any member). */
  listMonthNotes(headers: Headers, poolId: string, query: unknown): Promise<MonthNoteListDto>;
}

export interface NotesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const firstDay = (month: string) => `${month}-01`;

/** A note is always written by a person. */
function authorOf(ctx: PoolContext): string {
  if (ctx.actor.kind !== 'user') throw new ForbiddenError();
  return ctx.actor.userId;
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  async function setNote(
    headers: Headers,
    poolId: string,
    id: string,
    input: unknown,
    write: typeof notesRepo.setTransactionNote,
  ): Promise<NoteDto> {
    const session = await requireSession(auth, headers);
    const parsed = SetNoteInput.safeParse(input);
    if (!parsed.success) throw new ValidationError();
    const ctx = await requirePoolAccess(identity, session, poolId);
    can(ctx, 'notes.write');
    const rowId = parseId(id);
    const userId = authorOf(ctx);
    const text = parsed.data.note === null || parsed.data.note === '' ? null : parsed.data.note;
    const state = await run(ctx, (tx) => write(tx, ctx, rowId, text, userId, new Date()));
    if (!state) throw new NotFoundError();
    // The audit entry names the row only; the text never leaves the database.
    await recordAudit(identity, ctx, 'note.updated', { target: rowId, ip: ipOf(headers) });
    return NoteDto.parse(toNoteDto(state));
  }

  return {
    setTransactionNote: (headers, poolId, id, input) =>
      setNote(headers, poolId, id, input, (...args) => notesRepo.setTransactionNote(...args)),
    setOperationNote: (headers, poolId, id, input) =>
      setNote(headers, poolId, id, input, (...args) => notesRepo.setOperationNote(...args)),

    async getMonthNote(headers, poolId, month) {
      const session = await requireSession(auth, headers);
      if (!MonthParam.safeParse(month).success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const row = await run(ctx, (tx) => monthNotesRepo.find(tx, ctx, firstDay(month)));
      return MonthNoteDto.parse(row ? toMonthNoteDto(row) : emptyMonthNote(month));
    },

    async putMonthNote(headers, poolId, month, input) {
      const session = await requireSession(auth, headers);
      const parsed = PutMonthNoteInput.safeParse(input);
      if (!MonthParam.safeParse(month).success || !parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'notes.write');
      const userId = authorOf(ctx);
      const day = firstDay(month);
      const expected = parsed.data.expectedUpdatedAt
        ? new Date(parsed.data.expectedUpdatedAt)
        : null;
      const body = parsed.data.body;
      const now = new Date();

      const result = await run(ctx, async (tx) => {
        // The version the caller lost against, to hand back in the 409.
        const lost = async () => {
          const current = await monthNotesRepo.find(tx, ctx, day);
          return new ConflictError(
            'The note was changed by someone else.',
            MonthNoteDto.parse(current ? toMonthNoteDto(current) : emptyMonthNote(month)),
          );
        };
        const existing = await monthNotesRepo.find(tx, ctx, day);
        if (!existing) {
          if (expected) throw await lost();
          if (body === '') return { dto: emptyMonthNote(month), id: null };
          const created = await monthNotesRepo.insert(tx, ctx, {
            id: newId(),
            month: day,
            body,
            userId,
            at: now,
          });
          if (!created) throw await lost();
          return { dto: toMonthNoteDto(created), id: created.id };
        }
        if (!expected || existing.updatedAt.getTime() !== expected.getTime()) throw await lost();
        if (body === '') {
          if (!(await monthNotesRepo.removeIfVersion(tx, ctx, existing.id, expected))) {
            throw await lost();
          }
          return { dto: emptyMonthNote(month), id: existing.id };
        }
        const updated = await monthNotesRepo.updateIfVersion(tx, ctx, existing.id, expected, {
          body,
          userId,
          at: now,
        });
        if (!updated) throw await lost();
        return { dto: toMonthNoteDto(updated), id: updated.id };
      });
      if (result.id) {
        await recordAudit(identity, ctx, 'note.updated', { target: result.id, ip: ipOf(headers) });
      }
      return MonthNoteDto.parse(result.dto);
    },

    async listMonthNotes(headers, poolId, query) {
      const session = await requireSession(auth, headers);
      const parsed = ListMonthsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) =>
        monthNotesRepo.list(tx, ctx, firstDay(parsed.data.from), firstDay(parsed.data.to)),
      );
      return MonthNoteListDto.parse({ months: rows.map(toMonthNoteDto) });
    },
  };
}
