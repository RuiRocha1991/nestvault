import { addDays, isYmd, lisbonDayStart } from './lisbon-date';

/** Entries per page of the audit screen. */
export const AUDIT_PAGE_SIZE = 25;

export type AuditRange = '7' | '30' | 'all' | 'custom';

/** The filters of the audit screen, as the URL holds them. */
export interface AuditFilters {
  /** One action code (`member.removed`), or a whole category (`member`); `null` is "all". */
  action: string | null;
  /** A member's user id; `null` is "everyone". */
  person: string | null;
  range: AuditRange;
  /** `yyyy-mm-dd`, inclusive; `null` when the range has no lower bound. */
  from: string | null;
  /** `yyyy-mm-dd`, inclusive; `null` when the range has no upper bound. */
  to: string | null;
  /** 1-based. */
  page: number;
}

export const DEFAULT_RANGE: AuditRange = '30';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export interface AuditVocabulary {
  /** Every action code the log can hold. */
  actions: readonly string[];
  /** Every category (the prefix of an action code). */
  categories: readonly string[];
}

/**
 * Reads the screen's filters from the URL. Anything unknown or malformed falls back to the
 * default instead of failing: a stale or hand-edited link still opens a sensible list.
 * `today` is the Lisbon day (`yyyy-mm-dd`) the presets count back from.
 */
export function parseAuditFilters(
  params: SearchParams,
  vocabulary: AuditVocabulary,
  today: string,
): AuditFilters {
  const rawAction = first(params.action);
  const action =
    rawAction &&
    (vocabulary.actions.includes(rawAction) || vocabulary.categories.includes(rawAction))
      ? rawAction
      : null;
  const rawPerson = first(params.person);
  const person = rawPerson && UUID.test(rawPerson) ? rawPerson.toLowerCase() : null;
  const pageNumber = Number(first(params.page));
  const page =
    Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10_000 ? pageNumber : 1;

  const rawFrom = first(params.from);
  const rawTo = first(params.to);
  const custom = (rawFrom && isYmd(rawFrom)) || (rawTo && isYmd(rawTo));
  if (custom) {
    let from = rawFrom && isYmd(rawFrom) ? rawFrom : null;
    let to = rawTo && isYmd(rawTo) ? rawTo : null;
    if (from && to && from > to) [from, to] = [to, from];
    return { action, person, range: 'custom', from, to, page };
  }
  const rawRange = first(params.range);
  const range: AuditRange =
    rawRange === '7' || rawRange === 'all' || rawRange === '30' ? rawRange : DEFAULT_RANGE;
  if (range === 'all') return { action, person, range, from: null, to: null, page };
  return { action, person, range, from: addDays(today, -Number(range)), to: today, page };
}

/** The query string of a set of filters; defaults are left out so the plain link stays short. */
export function auditSearch(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.person) params.set('person', filters.person);
  if (filters.range === 'custom') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  } else if (filters.range !== DEFAULT_RANGE) {
    params.set('range', filters.range);
  }
  if (filters.page > 1) params.set('page', String(filters.page));
  return params.toString();
}

/** The query the audit service takes for these filters. */
export function auditQuery(filters: AuditFilters): Record<string, string | number> {
  const query: Record<string, string | number> = { limit: AUDIT_PAGE_SIZE, page: filters.page };
  if (filters.action) {
    // A category has no dot; an action code always has one.
    query[filters.action.includes('.') ? 'action' : 'category'] = filters.action;
  }
  if (filters.person) query.userId = filters.person;
  if (filters.from) query.from = lisbonDayStart(filters.from).toISOString();
  // `to` is inclusive for the person, exclusive for the service: up to the start of the next day.
  if (filters.to) query.to = lisbonDayStart(addDays(filters.to, 1)).toISOString();
  return query;
}
