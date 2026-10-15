const ZONE = 'Europe/Lisbon';
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function wallParts(at: Date) {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(wallClock.formatToParts(at).find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Minutes Lisbon is ahead of UTC at that instant (0 in winter, 60 in summer time). */
function offsetMinutes(at: Date): number {
  const p = wallParts(at);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - at.getTime()) / 60_000);
}

/** `yyyy-mm-dd` of the calendar day it is in Lisbon at `now`. */
export function todayInLisbon(now: Date = new Date()): string {
  const p = wallParts(now);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** An instant as the Lisbon wall clock shows it: the day (`yyyy-mm-dd`) and `HH:mm:ss`. */
export function lisbonDateTime(at: Date | string): { date: string; time: string } {
  const p = wallParts(typeof at === 'string' ? new Date(at) : at);
  const two = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${String(p.year).padStart(4, '0')}-${two(p.month)}-${two(p.day)}`,
    time: `${two(p.hour)}:${two(p.minute)}:${two(p.second)}`,
  };
}

/** True for a real calendar day written `yyyy-mm-dd` (no 31 February). */
export function isYmd(value: string): boolean {
  const match = YMD.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The day `days` after (or before, when negative) a `yyyy-mm-dd` day. */
export function addDays(ymd: string, days: number): string {
  const match = YMD.exec(ymd);
  if (!match) throw new RangeError('Expected yyyy-mm-dd');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** The instant a Lisbon calendar day starts (`yyyy-mm-dd`), which is not midnight UTC in summer. */
export function lisbonDayStart(ymd: string): Date {
  const match = YMD.exec(ymd);
  if (!match) throw new RangeError('Expected yyyy-mm-dd');
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const guess = new Date(utcMidnight - offsetMinutes(new Date(utcMidnight)) * 60_000);
  return new Date(utcMidnight - offsetMinutes(guess) * 60_000);
}

/** `dd/mm/aaaa` typed by a person → `yyyy-mm-dd`, or `null` when it is not a real day. */
export function parseTypedDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const ymd = `${match[3]}-${(match[2] ?? '').padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`;
  return isYmd(ymd) ? ymd : null;
}
