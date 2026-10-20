/** Default series colours, in assignment order (design system §3, data colours). */
export const SERIES_COLORS = [
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

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] as string;
}
