import { Chip, ProgressRing, cn, formatDate, formatMoney } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { perYear, statusKey, type GoalView, monthYear } from '@webapp/lib/goals-view';
import { goalTone } from '@webapp/lib/overview-view';

/** One goal: ring, name, status and the numbers that depend on the deadline mode. */
export function GoalCard({
  goal,
  selected,
  onSelect,
}: {
  goal: GoalView;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('goals');
  const status = useTranslations('overview.goals.status');
  const { result } = goal;
  const money = (value: string | number) => {
    const text = formatMoney(value, 'EUR', { digits: 2 });
    return perYear(goal) ? t('perYear', { value: text }) : text;
  };
  const kind = t(`type.${goal.type}`);
  const subtitle = goal.deadline
    ? t('subtitle', { kind, date: formatDate(goal.deadline) })
    : t('subtitleOpen', { kind });
  const missing = Math.max(0, Number(result.target) - Number(result.current));

  const rows: [string, string, string?][] = [
    [t('row.current'), money(result.current)],
    [t('row.target'), money(result.target)],
  ];
  if (result.mode === 'date') {
    rows.push([
      t('row.projected'),
      result.projected ? money(result.projected) : '—',
      result.onTrack || result.done ? 'text-pos' : 'text-warn',
    ]);
    if (goal.type !== 'contrib') {
      rows.push([t('row.monthly'), formatMoney(result.monthly, 'EUR')]);
    }
    rows.push([t('row.required'), result.required ? formatMoney(result.required, 'EUR') : '—']);
  } else {
    rows.push([t('row.missing'), money(missing)]);
    if (result.mode === 'eta') {
      rows.push([t('row.monthly'), formatMoney(result.monthly, 'EUR')]);
      rows.push([
        t('row.forecast'),
        result.etaMonth && result.reachIn !== null
          ? t('row.forecastValue', { month: monthYear(result.etaMonth), months: result.reachIn })
          : '—',
      ]);
    }
  }

  return (
    <article
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-md border bg-panel p-5 shadow-card',
        selected ? 'border-accent' : 'border-transparent',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex items-start gap-4 text-left"
      >
        <ProgressRing
          value={Number(result.progress)}
          label={t('chart.title', { name: goal.name })}
          color={goal.color}
          size={56}
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold">{goal.name}</span>
          <span className="text-sm text-fg-3">{subtitle}</span>
          <span className="flex">
            <Chip tone={goalTone(result.status) === 'pos' ? 'pos' : 'warn'}>
              {status(statusKey(result.status), {
                month: result.etaMonth ? monthYear(result.etaMonth) : '',
              })}
            </Chip>
          </span>
        </span>
      </button>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="contents">
            <dt className="text-fg-3">{label}</dt>
            <dd className={cn('m-0 text-right font-medium tabular-nums', tone)}>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
