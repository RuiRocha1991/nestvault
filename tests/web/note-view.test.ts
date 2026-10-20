import { describe, expect, it } from 'vitest';

import {
  firstLine,
  isDirty,
  isNoteHotkey,
  isSaveShortcut,
  noteBody,
  notePath,
} from '@webapp/lib/note-view';

type Target = Parameters<typeof isNoteHotkey>[0]['target'];
const on = (target: object): Target => target as Target;

const key = (k: string, over: Partial<Parameters<typeof isNoteHotkey>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: on({ tagName: 'TR' }),
  ...over,
});

describe('note-view', () => {
  it('builds the note endpoint of each kind and encodes the ids', () => {
    expect(notePath('p1', 'transaction', 't1')).toBe('/api/v1/pools/p1/transactions/t1/note');
    expect(notePath('p1', 'operation', 'o1')).toBe('/api/v1/pools/p1/ops/o1/note');
    expect(notePath('a/b', 'transaction', '../x')).toBe(
      '/api/v1/pools/a%2Fb/transactions/..%2Fx/note',
    );
  });

  it('takes the first non-empty line for the tooltip', () => {
    expect(firstLine('\n  \r\n  first \nsecond')).toBe('first');
    expect(firstLine('   ')).toBe('');
  });

  it('sends the trimmed text, and null to clear', () => {
    expect(noteBody('  hello \n')).toEqual({ note: 'hello' });
    expect(noteBody('   ')).toEqual({ note: null });
  });

  it('treats empty text and no note as equal', () => {
    expect(isDirty(null, '  ')).toBe(false);
    expect(isDirty('a', 'a ')).toBe(false);
    expect(isDirty('a', 'b')).toBe(true);
    expect(isDirty(null, 'b')).toBe(true);
  });

  it('opens the note on N, but not while typing or with a modifier', () => {
    expect(isNoteHotkey(key('n'))).toBe(true);
    expect(isNoteHotkey(key('N'))).toBe(true);
    expect(isNoteHotkey(key('x'))).toBe(false);
    expect(isNoteHotkey(key('n', { ctrlKey: true }))).toBe(false);
    expect(isNoteHotkey(key('n', { metaKey: true }))).toBe(false);
    expect(isNoteHotkey(key('n', { target: on({ tagName: 'TEXTAREA' }) }))).toBe(false);
    expect(isNoteHotkey(key('n', { target: on({ tagName: 'INPUT' }) }))).toBe(false);
    expect(isNoteHotkey(key('n', { target: on({ isContentEditable: true }) }))).toBe(false);
  });

  it('saves on Ctrl/Cmd+Enter only', () => {
    expect(isSaveShortcut({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isSaveShortcut({ key: 'Enter', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isSaveShortcut({ key: 'Enter', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isSaveShortcut({ key: 'a', ctrlKey: true, metaKey: false })).toBe(false);
  });
});
