'use client';

import type { KeyboardEvent, MouseEvent } from 'react';

import { isNoteHotkey } from '@webapp/lib/note-view';

/**
 * Props for a table row that opens its note: click, or `N` while the row has focus. A click on a
 * button, link or field inside the row keeps its own job.
 */
export function useNoteRow(onOpen: () => void) {
  return {
    tabIndex: 0,
    onClick: (event: MouseEvent<HTMLElement>) => {
      const inner = (event.target as HTMLElement).closest('a,button,input,select,textarea');
      if (inner === null || inner === event.currentTarget) onOpen();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (isNoteHotkey(event)) {
        event.preventDefault();
        onOpen();
      }
    },
  };
}
