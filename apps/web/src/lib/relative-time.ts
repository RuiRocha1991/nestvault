const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What is left until `date`, in the largest whole unit, and whether it is under two days. */
export interface Remaining {
  unit: 'day' | 'hour' | 'minute';
  count: number;
  soon: boolean;
}

/**
 * The time left until `date`, or `null` once it has passed. The screen words it from its messages
 * ("em 5 dias", "amanhã"), so the text is the one of the design and not whatever ICU says.
 */
export function remainingUntil(date: Date, now: Date = new Date()): Remaining | null {
  const seconds = Math.floor((date.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return null;
  const soon = seconds < 2 * DAY;
  if (seconds >= DAY) return { unit: 'day', count: Math.floor(seconds / DAY), soon };
  if (seconds >= HOUR) return { unit: 'hour', count: Math.floor(seconds / HOUR), soon };
  return { unit: 'minute', count: Math.max(1, Math.floor(seconds / MINUTE)), soon };
}

/** "agora", "há 3 horas", "ontem", "há 12 dias" for how long ago `date` was (pt-PT). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const formatter = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < MINUTE) return formatter.format(0, 'second');
  if (seconds < HOUR) return formatter.format(-Math.floor(seconds / MINUTE), 'minute');
  if (seconds < DAY) return formatter.format(-Math.floor(seconds / HOUR), 'hour');
  return formatter.format(-Math.floor(seconds / DAY), 'day');
}
