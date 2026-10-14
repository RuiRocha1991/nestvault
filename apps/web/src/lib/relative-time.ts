const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 3 horas", "ontem", "há 12 dias" for how long ago `date` was (pt-PT). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const formatter = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < MINUTE) return formatter.format(0, 'second');
  if (seconds < HOUR) return formatter.format(-Math.floor(seconds / MINUTE), 'minute');
  if (seconds < DAY) return formatter.format(-Math.floor(seconds / HOUR), 'hour');
  return formatter.format(-Math.floor(seconds / DAY), 'day');
}
