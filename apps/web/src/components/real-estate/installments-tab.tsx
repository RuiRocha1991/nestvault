'use client';

import { DEFAULT_ENABLED_LOAN_FIELDS, dec } from '@nestvault/domain/browser';
import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Modal,
  Segmented,
  Select,
  Table,
  Td,
  Th,
  cn,
  formatDate,
  formatMoney,
} from '@nestvault/ui';
import { Download, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { InstallmentFieldDialog } from '@webapp/components/real-estate/installment-field-dialog';
import { Stat } from '@webapp/components/real-estate/parts';
import {
  installmentFields,
  installmentRows,
  installmentsCsv,
  summarizeInstallments,
  visibleFields,
  type InstallmentField,
  type InstallmentRow,
} from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

type StatusFilter = 'all' | 'paid' | 'projected';

/** Per-viewer column choices (browser storage; which fields are on is per loan, on the server). */
interface ColumnPrefs {
  remaining: boolean;
  state: boolean;
  hideEmpty: boolean;
}
const DEFAULT_PREFS: ColumnPrefs = { remaining: true, state: true, hideEmpty: true };
const DEFAULT_KEYS: readonly string[] = DEFAULT_ENABLED_LOAN_FIELDS;
const PREFS_KEY = 'nv-installment-columns';

function readPrefs(): ColumnPrefs {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS;
    const stored = raw as Record<string, unknown>;
    const flag = (key: keyof ColumnPrefs) =>
      typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_PREFS[key];
    return { remaining: flag('remaining'), state: flag('state'), hideEmpty: flag('hideEmpty') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: ColumnPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be blocked: the choice then lasts until the page is closed.
  }
}

function Switch({
  checked,
  onChange,
  label,
  locked,
}: {
  checked: boolean;
  onChange?: (value: boolean) => void;
  label: string;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={locked}
      onClick={() => {
        onChange?.(!checked);
      }}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border border-line-2 transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'bg-inset',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full bg-fg transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

/**
 * Mockups 29, 45 and 46: the installments with a status and year filter, a summary of the period
 * and a totals row. The loan's enabled fields are the columns (and count in every total); the
 * "Colunas" menu turns fields on and off per loan, and the optional basic columns per viewer.
 */
export function InstallmentsTab({
  poolId,
  bundle,
  today,
}: {
  poolId: string;
  bundle: LoanBundle | undefined;
  /** Today in Lisbon (`yyyy-mm-dd`): the year the filter starts on. */
  today: string;
}) {
  const t = useTranslations('realEstate.installments');
  const router = useRouter();
  const rows = useMemo(() => (bundle ? installmentRows(bundle) : []), [bundle]);
  const fields = useMemo(() => (bundle ? installmentFields(bundle) : []), [bundle]);
  const years = useMemo(
    () => [...new Set(rows.map((row) => row.dueDate.slice(0, 4)))].sort(),
    [rows],
  );
  const [status, setStatus] = useState<StatusFilter>('all');
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState(years.includes(thisYear) ? thisYear : (years[0] ?? ''));
  const [prefs, setPrefs] = useState<ColumnPrefs>(DEFAULT_PREFS);
  const [menu, setMenu] = useState(false);
  const [newField, setNewField] = useState(false);
  const [confirm, setConfirm] = useState<InstallmentField | null>(null);
  const [failed, setFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  if (!bundle || rows.length === 0) {
    return (
      <Card>
        <EmptyState title={t('empty')} />
      </Card>
    );
  }

  const { loan } = bundle;
  const shown = rows.filter(
    (row: InstallmentRow) =>
      (status === 'all' || row.status === status) && (!year || row.dueDate.startsWith(year)),
  );
  const summary = summarizeInstallments(shown);
  const columns = visibleFields(fields, shown, prefs.hideEmpty);
  const labelOf = (field: InstallmentField) =>
    field.kind === 'builtin' ? t(`fields.${field.key}`) : field.label;

  const changePrefs = (next: Partial<ColumnPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    writePrefs(merged);
  };

  async function patchField(key: string, enabled: boolean): Promise<boolean> {
    try {
      const response = await fetch(
        `/api/v1/pools/${encodeURIComponent(poolId)}/loans/${encodeURIComponent(loan.id)}/fields/${encodeURIComponent(key)}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async function toggleField(field: InstallmentField, enabled: boolean) {
    setFailed(false);
    if (await patchField(field.key, enabled)) router.refresh();
    else setFailed(true);
  }

  function requestToggle(field: InstallmentField, enabled: boolean) {
    // Hiding a field that holds values asks first: the values stay, but the totals change.
    if (!enabled && field.hasValues) setConfirm(field);
    else void toggleField(field, enabled);
  }

  async function resetColumns() {
    setPrefs(DEFAULT_PREFS);
    writePrefs(DEFAULT_PREFS);
    setFailed(false);
    const defaults = DEFAULT_KEYS;
    const changes = fields.filter(
      (field) => field.kind === 'builtin' && field.enabled !== defaults.includes(field.key),
    );
    const results = await Promise.all(
      changes.map((field) => patchField(field.key, defaults.includes(field.key))),
    );
    if (results.length > 0) router.refresh();
    setFailed(results.includes(false));
  }

  function exportCsv() {
    const csv = installmentsCsv(
      shown,
      fields.map((field) => ({ ...field, label: labelOf(field) })),
      {
        number: t('number'),
        date: t('date'),
        capital: t('capital'),
        interest: t('interest'),
        total: t('total'),
      },
    );
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('csvName')}-${loan.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const basics = ['number', 'capital', 'interest', 'total'] as const;
  const tableMoney = (value: string) => (dec(value).isZero() ? t('noValue') : formatMoney(value));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('summaryTitle', { year: year || t('allYears') })}
          subtitle={t('summaryText', { paid: summary.paid, projected: summary.projected })}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          <Stat label={t('capital')}>{formatMoney(summary.capital)}</Stat>
          <Stat label={t('interest')}>{formatMoney(summary.interest)}</Stat>
          {columns.map((field) => (
            <Stat key={field.key} label={labelOf(field)}>
              {formatMoney(summary.fields[field.key] ?? '0')}
            </Stat>
          ))}
          <Stat label={t('total')}>{formatMoney(summary.total)}</Stat>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<StatusFilter>
            label={t('statusFilter')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('all') },
              { value: 'paid', label: t('paid') },
              { value: 'projected', label: t('projected') },
            ]}
          />
          <Select
            compact
            aria-label={t('yearFilter')}
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
            }}
          >
            <option value="">{t('allYears')}</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {t('yearOption', { year: value })}
              </option>
            ))}
          </Select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={exportCsv}>
              <Download aria-hidden />
              {t('exportCsv')}
            </Button>
            <div ref={menuRef} className="relative">
              <Button
                size="sm"
                aria-haspopup="dialog"
                aria-expanded={menu}
                onClick={() => {
                  setMenu((open) => !open);
                }}
              >
                <SlidersHorizontal aria-hidden />
                {t('columns.button')}
              </Button>
              {menu && (
                <div
                  role="dialog"
                  aria-label={t('columns.title')}
                  className={cn(
                    'absolute right-0 top-full z-30 mt-2 flex max-h-[70dvh] w-[min(320px,calc(100vw-32px))]',
                    'flex-col gap-1 overflow-auto rounded-lg border border-line-2 bg-panel p-4',
                    'shadow-[0_24px_64px_rgba(0,0,0,0.35)]',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <b>{t('columns.title')}</b>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void resetColumns();
                      }}
                    >
                      {t('columns.reset')}
                    </Button>
                  </div>
                  <ColumnsHeading>{t('columns.basic')}</ColumnsHeading>
                  {basics.map((key) => (
                    <MenuRow key={key} label={t(`columns.${key}`)}>
                      <Switch checked locked label={t(`columns.${key}`)} />
                    </MenuRow>
                  ))}
                  <MenuRow label={t('remaining')}>
                    <Switch
                      checked={prefs.remaining}
                      label={t('remaining')}
                      onChange={(value) => {
                        changePrefs({ remaining: value });
                      }}
                    />
                  </MenuRow>
                  <MenuRow label={t('state')}>
                    <Switch
                      checked={prefs.state}
                      label={t('state')}
                      onChange={(value) => {
                        changePrefs({ state: value });
                      }}
                    />
                  </MenuRow>
                  <ColumnsHeading>
                    {t('columns.fields')}{' '}
                    <span className="normal-case tracking-normal">{t('columns.fieldsHint')}</span>
                  </ColumnsHeading>
                  {fields.map((field) => (
                    <MenuRow
                      key={field.key}
                      label={labelOf(field)}
                      hint={
                        field.kind === 'builtin' && DEFAULT_KEYS.includes(field.key)
                          ? t('columns.default')
                          : undefined
                      }
                    >
                      <Switch
                        checked={field.enabled}
                        label={labelOf(field)}
                        onChange={(value) => {
                          requestToggle(field, value);
                        }}
                      />
                    </MenuRow>
                  ))}
                  <Button
                    size="sm"
                    className="mt-1 self-start"
                    onClick={() => {
                      setNewField(true);
                      setMenu(false);
                    }}
                  >
                    {t('columns.newField')}
                  </Button>
                  <hr className="my-2 border-line" />
                  <MenuRow label={t('columns.hideEmpty')} hint={t('columns.hideEmptyHint')}>
                    <Switch
                      checked={prefs.hideEmpty}
                      label={t('columns.hideEmpty')}
                      onChange={(value) => {
                        changePrefs({ hideEmpty: value });
                      }}
                    />
                  </MenuRow>
                  {failed && (
                    <p role="alert" className="m-0 text-sm text-neg">
                      {t('columns.failed')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t('number')}</Th>
              <Th>{t('date')}</Th>
              <Th numeric>{t('capital')}</Th>
              <Th numeric>{t('interest')}</Th>
              {columns.map((field) => (
                <Th key={field.key} numeric>
                  {labelOf(field)}
                </Th>
              ))}
              <Th numeric>{t('total')}</Th>
              {prefs.remaining && <Th numeric>{t('remaining')}</Th>}
              {prefs.state && <Th>{t('state')}</Th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.number} className={row.status === 'projected' ? 'text-fg-2' : undefined}>
                <Td>{row.number}</Td>
                <Td>{formatDate(row.dueDate)}</Td>
                <Td numeric>{formatMoney(row.capital)}</Td>
                <Td numeric>{formatMoney(row.interest)}</Td>
                {columns.map((field) => (
                  <Td key={field.key} numeric>
                    {tableMoney(row.amounts[field.key] ?? '0')}
                  </Td>
                ))}
                <Td numeric>
                  <b>{formatMoney(row.total)}</b>
                </Td>
                {prefs.remaining && <Td numeric>{row.remaining}</Td>}
                {prefs.state && (
                  <Td>
                    <Chip tone={row.status === 'paid' ? 'pos' : 'default'}>
                      {t(row.status === 'paid' ? 'statusPaid' : 'statusProjected')}
                    </Chip>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Td className="font-bold">{t('totalRow')}</Td>
              <Td />
              <Td numeric className="font-bold">
                {formatMoney(summary.capital)}
              </Td>
              <Td numeric className="font-bold">
                {formatMoney(summary.interest)}
              </Td>
              {columns.map((field) => (
                <Td key={field.key} numeric className="font-bold">
                  {formatMoney(summary.fields[field.key] ?? '0')}
                </Td>
              ))}
              <Td numeric className="font-bold">
                {formatMoney(summary.total)}
              </Td>
              {prefs.remaining && <Td />}
              {prefs.state && <Td />}
            </tr>
          </tfoot>
        </Table>
        <p className="text-xs text-fg-3">{t('note')}</p>
      </Card>

      <InstallmentFieldDialog
        open={newField}
        onOpenChange={setNewField}
        poolId={poolId}
        loanId={loan.id}
        takenKeys={fields.map((field) => field.key)}
        today={today}
        onSaved={() => {
          router.refresh();
        }}
      />
      <Modal
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t('disable.title')}
        closeLabel={t('disable.close')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(null);
              }}
            >
              {t('disable.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirm) void toggleField(confirm, false);
                setConfirm(null);
              }}
            >
              {t('disable.confirm')}
            </Button>
          </>
        }
      >
        <p className="m-0 text-fg-2">
          {t('disable.text', { name: confirm ? labelOf(confirm) : '' })}
        </p>
      </Modal>
    </div>
  );
}

function ColumnsHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mt-2 text-xs font-bold uppercase tracking-[0.08em] text-fg-3">{children}</p>
  );
}

function MenuRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-md">
      <span className="min-w-0">
        {label}
        {!!hint && <span className="block text-xs text-fg-3">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
