/** `yyyy-mm`, month 01 to 12 (the URL segment of the monthly review). */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthSegment = (value: string): boolean => MONTH.test(value);

/** The monthly review of a month (`/[poolId]/mes/[yyyy-mm]`). */
export const monthHref = (poolId: string, month: string): string =>
  `/${encodeURIComponent(poolId)}/mes/${month}`;

const long = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const short = new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' });

const firstOf = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** "março de 2026". */
export const monthLabel = (month: string): string => long.format(firstOf(month));

/** "mar". */
export const shortMonthLabel = (month: string): string =>
  short.format(firstOf(month)).replace('.', '');

/** The month with the first letter in capitals, for headings. */
export const monthTitle = (month: string): string => {
  const label = monthLabel(month);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** Who edited a note: the member's name, resolved from the members list. */
export function editorNameOf(
  userId: string | null,
  members: readonly { id: string; name: string }[],
): string | null {
  if (userId === null) return null;
  return members.find((member) => member.id === userId)?.name ?? null;
}
