'use client';

import { Button, Chip, formatDate } from '@nestvault/ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import {
  CATEGORY_TONE,
  FAILED_SIGN_IN,
  shortId,
  splitAction,
  type AuditEntryView,
} from '@webapp/lib/audit-view';
import { lisbonDateTime } from '@webapp/lib/lisbon-date';

import type { useAuditLabels } from './use-audit-labels';

type Labels = ReturnType<typeof useAuditLabels>;

/** Side panel on wide screens, full-screen sheet on narrow ones (mockups 77 and mobile-12). */
export function AuditDetail({
  entry,
  labels,
  onClose,
}: {
  entry: AuditEntryView;
  labels: Labels;
  onClose: () => void;
}) {
  const t = useTranslations('audit');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [entry.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const { category } = splitAction(entry.action);
  const when = lisbonDateTime(entry.at);
  const person = labels.person(entry);
  const rows: [string, string][] = [
    [t('detail.when'), t('detail.whenValue', { date: formatDate(when.date), time: when.time })],
    [t('detail.who'), person ?? t('person.unknown')],
    [t('detail.target'), labels.target(entry)],
    ...(entry.ipMasked ? [[t('detail.address'), entry.ipMasked] as [string, string]] : []),
    [t('detail.id'), shortId(entry.id)],
  ];
  const data = Object.entries(entry.meta);

  return (
    <aside
      aria-label={t('detail.title')}
      className="flex flex-col gap-3 rounded-md bg-panel px-5 py-4 shadow-card drawer:fixed drawer:inset-0 drawer:z-40 drawer:overflow-y-auto drawer:rounded-none"
    >
      <header className="flex items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{t('detail.title')}</h2>
        <Button variant="ghost" icon aria-label={t('detail.close')} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>
      <div>
        <Chip
          tone={entry.action === FAILED_SIGN_IN ? 'warn' : (CATEGORY_TONE[category] ?? 'default')}
        >
          {labels.category(entry.action)}
        </Chip>
      </div>
      <div className="flex flex-col">
        <h3 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
          {labels.title(entry.action)}
        </h3>
        <code className="font-mono text-xs text-fg-3">{entry.action}</code>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-3">{label}</dt>
            <dd className="m-0 break-words text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
        {t('detail.data')}
      </h3>
      {data.length > 0 ? (
        <pre className="m-0 overflow-x-auto rounded-md bg-inset p-3 font-mono text-xs text-fg">
          {data
            .map(([key, value]) => `${labels.metaKey(key)}: ${labels.metaValue(key, value)}`)
            .join('\n')}
        </pre>
      ) : (
        <p className="text-sm text-fg-3">{t('detail.noData')}</p>
      )}
      <p className="text-xs text-fg-3">{t('detail.note')}</p>
    </aside>
  );
}
