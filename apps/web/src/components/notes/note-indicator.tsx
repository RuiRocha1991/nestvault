import { MessageSquare } from 'lucide-react';

import { firstLine } from '@webapp/lib/note-view';

export interface NoteIndicatorProps {
  /** The movement's note; nothing is drawn while it has none. */
  note: string | null;
  /** Accessible name of the button ("Ver nota"). */
  label: string;
  onOpen: () => void;
}

/** The speech bubble of a movement that has a note; the tooltip is the note's first line. */
export function NoteIndicator({ note, label, onOpen }: NoteIndicatorProps) {
  if (note === null || note.trim() === '') return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={firstLine(note)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="inline-flex size-6 items-center justify-center rounded-sm text-accent-2 hover:bg-panel-2"
    >
      <MessageSquare aria-hidden className="size-4" />
    </button>
  );
}
