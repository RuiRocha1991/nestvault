/**
 * Data colours for the people of the household (the prototype's series palette, `PALETTE` in v28).
 * They are data colours, not interface tokens, so hex values are allowed here.
 */
export const HOLDER_PALETTE = [
  '#9D6BFF',
  '#F2913D',
  '#3BA7F2',
  '#E5424D',
  '#2BC6B4',
  '#F2C43D',
  '#E356A8',
  '#3CCB7F',
  '#6C5CFF',
  '#FF7A59',
  '#5B8DEF',
  '#8C8FB8',
] as const;

/** The first palette colour no holder uses yet; once all are taken, the palette starts over. */
export function nextHolderColor(used: readonly string[]): string {
  const taken = new Set(used.map((color) => color.toUpperCase()));
  const free = HOLDER_PALETTE.find((color) => !taken.has(color));
  return free ?? HOLDER_PALETTE[used.length % HOLDER_PALETTE.length] ?? HOLDER_PALETTE[0];
}
