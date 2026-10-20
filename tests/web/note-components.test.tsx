import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NoteIndicator } from '@webapp/components/notes/note-indicator';
import { NoteText } from '@webapp/components/notes/note-text';

const noop = () => undefined;

describe('note components', () => {
  it('draws nothing for a movement without a note', () => {
    expect(renderToStaticMarkup(<NoteIndicator note={null} label="Ver nota" onOpen={noop} />)).toBe(
      '',
    );
    expect(renderToStaticMarkup(<NoteIndicator note="  " label="Ver nota" onOpen={noop} />)).toBe(
      '',
    );
  });

  it('shows the first line as the tooltip, with an accessible name', () => {
    const html = renderToStaticMarkup(
      <NoteIndicator note={'Renda de outubro\nsegunda linha'} label="Ver nota" onOpen={noop} />,
    );
    expect(html).toContain('title="Renda de outubro"');
    expect(html).toContain('aria-label="Ver nota"');
    expect(html).toContain('text-accent-2');
  });

  it('renders HTML in a note as escaped text', () => {
    const html = renderToStaticMarkup(<NoteText text="<img src=x onerror=alert(1)>" />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('whitespace-pre-wrap');
  });

  it('does not turn links into anchors', () => {
    expect(renderToStaticMarkup(<NoteText text="https://example.com" />)).not.toContain('<a');
  });
});
