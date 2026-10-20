/**
 * A note as plain text with its line breaks. It is a React text node, so HTML in it is shown as
 * characters, and links are not turned into anchors (v1).
 */
export function NoteText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words text-md text-fg">{text}</p>;
}
