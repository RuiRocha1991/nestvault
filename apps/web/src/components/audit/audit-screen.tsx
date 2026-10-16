'use client';

import { Button, Card, Chip, cn, EmptyState, formatDate, Table, Td, Th } from '@nestvault/ui';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, useTransition, type ReactNode } from 'react';

import { MemberAvatar } from '@webapp/components/members/member-avatar';
import { auditSearch, type AuditFilters } from '@webapp/lib/audit-filters';
import {
  CATEGORY_TONE,
  FAILED_SIGN_IN,
  splitAction,
  type AuditActionGroup,
  type AuditEntryView,
} from '@webapp/lib/audit-view';
import { lisbonDateTime } from '@webapp/lib/lisbon-date';

import { AuditDetail } from './audit-detail';
import { AuditFiltersBar, isDefaultView } from './audit-filters-bar';
import { useAuditLabels } from './use-audit-labels';

export interface AuditScreenProps {
  filters: AuditFilters;
  today: string;
  entries: readonly AuditEntryView[];
  total: number;
  pageSize: number;
  /** Names by user id (lower case) for every actor and target on the page. */
  people: Readonly<Record<string, string>>;
  members: readonly { id: string; name: string }[];
  groups: readonly AuditActionGroup[];
}

const pageLinkStyles =
  'inline-flex h-7 items-center rounded-sm border border-line-2 bg-panel-2 px-2.5 text-sm font-semibold text-fg no-underline hover:border-accent-2';

/** A real link, so paging works before the page has hydrated and can be opened in a new tab. */
function PageLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        className={cn(pageLinkStyles, 'cursor-not-allowed opacity-50 hover:border-line-2')}
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} className={pageLinkStyles}>
      {children}
    </Link>
  );
}

/** Definições → Auditoria (mockups 76-78, mobile-12): filters, table, detail panel. */
export function AuditScreen({
  filters,
  today,
  entries,
  total,
  pageSize,
  people,
  members,
  groups,
}: AuditScreenProps) {
  const t = useTranslations('audit');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const labels = useAuditLabels(people);

  const go = useCallback(
    (patch: Partial<AuditFilters>) => {
      const query = auditSearch({ ...filters, page: 1, ...patch });
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname);
      });
    },
    [filters, pathname, router],
  );

  const pageHref = (page: number) => {
    const query = auditSearch({ ...filters, page });
    return query ? `${pathname}?${query}` : pathname;
  };

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const close = useCallback(() => {
    setSelectedId(null);
    opener.current?.focus();
  }, []);

  const firstShown = (filters.page - 1) * pageSize + 1;
  const lastShown = firstShown + entries.length - 1;
  const hasNext = lastShown < total;
  const previousHref = filters.page > 1 ? pageHref(filters.page - 1) : null;
  const nextHref = hasNext ? pageHref(filters.page + 1) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Card aria-busy={pending} className={pending ? 'opacity-70 transition-opacity' : undefined}>
          <AuditFiltersBar
            filters={filters}
            today={today}
            groups={groups}
            members={members}
            onChange={go}
          />

          {entries.length === 0 ? (
            <EmptyState
              title={t('states.emptyTitle')}
              description={t('states.emptyText')}
              action={
                !isDefaultView(filters) || filters.page > 1 ? (
                  <Button
                    onClick={() => {
                      go({ action: null, person: null, range: '30', from: null, to: null });
                    }}
                  >
                    {t('filters.clear')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table aria-label={t('table.caption')}>
              <thead>
                <tr>
                  <Th>{t('table.when')}</Th>
                  <Th>{t('table.person')}</Th>
                  <Th>{t('table.action')}</Th>
                  <Th>{t('table.target')}</Th>
                  <Th>{t('table.address')}</Th>
                  <Th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const when = lisbonDateTime(entry.at);
                  const person = labels.person(entry);
                  const failed = entry.action === FAILED_SIGN_IN;
                  const { category } = splitAction(entry.action);
                  return (
                    <tr
                      key={entry.id}
                      data-selected={entry.id === selectedId}
                      onClick={(event) => {
                        opener.current = event.currentTarget.querySelector('button');
                        setSelectedId(entry.id);
                      }}
                      className="cursor-pointer hover:bg-panel-2 data-[selected=true]:bg-accent-soft"
                    >
                      <Td className="whitespace-nowrap">
                        {formatDate(when.date)} <span className="text-fg-3">{when.time}</span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          {!!entry.userId && !!person && (
                            <MemberAvatar id={entry.userId} name={person} size="sm" />
                          )}
                          {person ?? <span className="text-fg-3">{t('person.unknown')}</span>}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <Chip tone={failed ? 'warn' : (CATEGORY_TONE[category] ?? 'default')}>
                            {labels.category(entry.action)}
                          </Chip>
                          <code className="font-mono text-xs text-fg-3">{entry.action}</code>
                        </div>
                      </Td>
                      <Td className={failed ? 'text-warn' : undefined}>{labels.target(entry)}</Td>
                      <Td className="whitespace-nowrap text-fg-3">{entry.ipMasked ?? '—'}</Td>
                      <Td className="w-8">
                        <button
                          type="button"
                          aria-label={t('table.open', {
                            when: `${formatDate(when.date)} ${when.time}`,
                          })}
                          className="grid size-7 place-items-center rounded-sm text-fg-2 hover:text-fg"
                        >
                          <ChevronRight aria-hidden className="size-4" />
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {total > 0 && (
            <nav
              aria-label={t('pagination.label')}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="text-sm text-fg-3">
                {t('pagination.range', {
                  from: entries.length > 0 ? firstShown : 0,
                  to: entries.length > 0 ? lastShown : 0,
                  total,
                })}
              </span>
              <span className="flex gap-2">
                <PageLink href={previousHref}>{t('pagination.previous')}</PageLink>
                <PageLink href={nextHref}>{t('pagination.next')}</PageLink>
              </span>
            </nav>
          )}
        </Card>

        {!!selected && (
          <div className="w-full lg:w-[340px]">
            <AuditDetail entry={selected} labels={labels} onClose={close} />
          </div>
        )}
      </div>

      <p className="flex items-start gap-3 rounded-md bg-panel px-5 py-3 text-sm text-fg-2 shadow-card">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{t.rich('readOnly', { b: (chunks) => <b className="text-fg">{chunks}</b> })}</span>
      </p>
    </div>
  );
}
