import { describe, expect, it } from 'vitest';

import {
  isMonthNoteDirty,
  monthNoteBody,
  monthNotePath,
  readMonthNote,
} from '../../apps/web/src/lib/month-note';
import {
  isMonthSegment,
  monthHref,
  monthLabel,
  monthTitle,
  shortMonthLabel,
  editorNameOf,
} from '../../apps/web/src/lib/month-view';

describe('month view helpers', () => {
  it('accepts only yyyy-mm with a real month', () => {
    expect(isMonthSegment('2026-03')).toBe(true);
    for (const bad of ['2026-13', '2026-3', '2026-03-01', "2026-03' OR 1=1", '', 'abc']) {
      expect(isMonthSegment(bad)).toBe(false);
    }
  });

  it('builds the review link and the Portuguese labels', () => {
    expect(monthHref('abc-123', '2026-03')).toBe('/abc-123/mes/2026-03');
    expect(monthLabel('2026-03')).toBe('março de 2026');
    expect(monthTitle('2026-03')).toBe('Março de 2026');
    expect(shortMonthLabel('2026-03')).toBe('mar');
  });

  it('names the editor of a note, or nobody', () => {
    const members = [{ id: 'u1', name: 'Rui' }];
    expect(editorNameOf('u1', members)).toBe('Rui');
    expect(editorNameOf('u2', members)).toBeNull();
    expect(editorNameOf(null, members)).toBeNull();
  });
});

describe('month note helpers', () => {
  const loaded = {
    month: '2026-03',
    id: null,
    body: null,
    createdBy: null,
    updatedBy: null,
    updatedAt: null,
  };

  it('sends the typed text with the version it was loaded from', () => {
    expect(monthNoteBody('  olá  ', loaded)).toEqual({ body: 'olá', expectedUpdatedAt: null });
    expect(monthNoteBody('x', { ...loaded, updatedAt: '2026-03-01T10:00:00.000Z' })).toEqual({
      body: 'x',
      expectedUpdatedAt: '2026-03-01T10:00:00.000Z',
    });
    expect(monthNotePath('p 1', '2026-03')).toBe('/api/v1/pools/p%201/months/2026-03/note');
  });

  it('tells a changed text from an unchanged one', () => {
    expect(isMonthNoteDirty(null, '')).toBe(false);
    expect(isMonthNoteDirty(null, '  ')).toBe(false);
    expect(isMonthNoteDirty('a', 'a ')).toBe(false);
    expect(isMonthNoteDirty('a', 'b')).toBe(true);
  });

  it('reads a note answer and refuses anything else', () => {
    expect(
      readMonthNote({ ...loaded, body: 'x', updatedAt: '2026-03-01T10:00:00.000Z' }),
    ).toMatchObject({
      body: 'x',
    });
    expect(readMonthNote(null)).toBeNull();
    expect(readMonthNote({ month: 5 })).toBeNull();
    expect(readMonthNote({ month: '2026-03', body: 3, updatedAt: null })).toBeNull();
  });
});
