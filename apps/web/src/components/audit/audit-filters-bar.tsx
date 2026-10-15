'use client';

import { formatDate, Input, Segmented, Select } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DEFAULT_RANGE, type AuditFilters, type AuditRange } from '@webapp/lib/audit-filters';
import type { AuditActionGroup } from '@webapp/lib/audit-view';
import { addDays, parseTypedDate } from '@webapp/lib/lisbon-date';

type Preset = Exclude<AuditRange, 'custom'>;

/** One dd/mm/aaaa field: it commits a real day (or an empty box) on blur or Enter. */
function DateField({
  label,
  value,
  onCommit,
}: {
  label: string;
  /** `yyyy-mm-dd` or `null`. The parent re-keys the field when this changes. */
  value: string | null;
  onCommit: (value: string | null) => void;
}) {
  const t = useTranslations('audit.filters');
  const [text, setText] = useState(value ? formatDate(value) : '');
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = parseTypedDate(text);
    setInvalid(parsed === null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };

  return (
    <label className="flex items-center gap-2 text-sm text-fg-3">
      {label}
      <Input
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('datePlaceholder')}
        value={text}
        aria-invalid={invalid}
        title={invalid ? t('dateInvalid') : undefined}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        className="!w-[112px] text-fg aria-[invalid=true]:border-neg"
      />
    </label>
  );
}

export interface AuditFiltersBarProps {
  filters: AuditFilters;
  /** The Lisbon day (`yyyy-mm-dd`) the 7 and 30 day presets count back from. */
  today: string;
  groups: readonly AuditActionGroup[];
  members: readonly { id: string; name: string }[];
  /** Applies a change; the page goes back to 1. */
  onChange: (patch: Partial<AuditFilters>) => void;
}

/** Action, person and period filters (mockup 76). The URL is the state: `onChange` navigates. */
export function AuditFiltersBar({
  filters,
  today,
  groups,
  members,
  onChange,
}: AuditFiltersBarProps) {
  const t = useTranslations('audit');

  const setRange = (range: Preset) => {
    if (range === 'all') onChange({ range, from: null, to: null });
    else onChange({ range, from: addDays(today, -Number(range)), to: today });
  };

  const setDates = (from: string | null, to: string | null) => {
    if (from === null && to === null) setRange('all');
    else onChange({ range: 'custom', from, to });
  };

  return (
    <div
      role="group"
      aria-label={t('filters.label')}
      className="flex flex-wrap items-center gap-2.5"
    >
      <Select
        aria-label={t('filters.action')}
        value={filters.action ?? ''}
        onChange={(event) => {
          onChange({ action: event.target.value || null });
        }}
        className="!w-auto"
      >
        <option value="">{t('filters.allActions')}</option>
        {groups.map((group) => (
          <optgroup key={group.category} label={t(`categories.${group.category}`)}>
            <option value={group.category}>
              {t('filters.wholeCategory', { category: t(`categories.${group.category}`) })}
            </option>
            {group.actions.map((action) => {
              const [, name = ''] = action.split('.');
              const key = name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
              return (
                <option key={action} value={action}>
                  {t(`actions.${group.category}.${key}`)}
                </option>
              );
            })}
          </optgroup>
        ))}
      </Select>
      <Select
        aria-label={t('filters.person')}
        value={filters.person ?? ''}
        onChange={(event) => {
          onChange({ person: event.target.value || null });
        }}
        className="!w-auto"
      >
        <option value="">{t('filters.allPeople')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
      <Segmented<Preset | 'none'>
        label={t('filters.range')}
        value={filters.range === 'custom' ? 'none' : filters.range}
        options={[
          { value: '7', label: t('filters.range7') },
          { value: '30', label: t('filters.range30') },
          { value: 'all', label: t('filters.rangeAll') },
        ]}
        onChange={(value) => {
          if (value !== 'none') setRange(value);
        }}
      />
      <DateField
        key={`from-${filters.from ?? ''}`}
        label={t('filters.from')}
        value={filters.from}
        onCommit={(from) => {
          setDates(from, filters.to);
        }}
      />
      <DateField
        key={`to-${filters.to ?? ''}`}
        label={t('filters.to')}
        value={filters.to}
        onCommit={(to) => {
          setDates(filters.from, to);
        }}
      />
    </div>
  );
}

export const isDefaultView = (filters: AuditFilters) =>
  !filters.action && !filters.person && filters.range === DEFAULT_RANGE;
