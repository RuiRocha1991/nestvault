'use client';

import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  LineChart,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormDialog } from '@webapp/components/portfolios/form-dialog';
import { goalChart, GOAL_COLORS, perYear, type GoalView, monthYear } from '@webapp/lib/goals-view';
import { poolApi } from '@webapp/lib/portfolio-forms';
import { sendJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

import { GoalCard } from './goal-card';
import { GoalDialog, type GoalScopeOptions } from './goal-dialog';

export interface GoalsScreenProps {
  poolId: string;
  /** Today in Lisbon (`yyyy-mm-dd`), the date the goals were calculated at. */
  asOf: string;
  goals: readonly GoalView[];
  scope: GoalScopeOptions;
  defaultMonthly: string;
  defaultDeadline: string;
  /** `goals.write`: the services enforce it, this only hides the buttons. */
  canWrite: boolean;
}

type Dialog = { kind: 'form'; goal?: GoalView } | { kind: 'delete'; goal: GoalView } | null;

/** The Objetivos screen: a card per goal, the projection of the selected one and the dialogs. */
export function GoalsScreen({
  poolId,
  asOf,
  goals,
  scope,
  defaultMonthly,
  defaultDeadline,
  canWrite,
}: GoalsScreenProps) {
  const t = useTranslations('goals');
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(goals[0]?.id ?? '');
  const [dialog, setDialog] = useState<Dialog>(null);
  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0];

  const close = () => {
    setDialog(null);
  };
  const done = () => {
    close();
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-fg-3">{t('intro')}</p>
        {canWrite && (
          <Button
            onClick={() => {
              setDialog({ kind: 'form' });
            }}
          >
            <Plus aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>

      {goals.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul
          aria-label={t('list')}
          className="m-0 grid list-none grid-cols-3 gap-4 p-0 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1"
        >
          {goals.map((goal) => (
            <li key={goal.id} className="flex min-w-0 flex-col">
              <GoalCard
                goal={goal}
                selected={goal.id === selected?.id}
                onSelect={() => {
                  setSelectedId(goal.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {!!selected && (
        <ProjectionCard
          goal={selected}
          asOf={asOf}
          canWrite={canWrite}
          onEdit={() => {
            setDialog({ kind: 'form', goal: selected });
          }}
          onDelete={() => {
            setDialog({ kind: 'delete', goal: selected });
          }}
        />
      )}

      {dialog?.kind === 'form' && (
        <GoalDialog
          poolId={poolId}
          goal={dialog.goal}
          scope={scope}
          defaultMonthly={defaultMonthly}
          defaultDeadline={defaultDeadline}
          color={GOAL_COLORS[goals.length % GOAL_COLORS.length] ?? GOAL_COLORS[0]}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteGoalDialog poolId={poolId} goal={dialog.goal} onClose={close} onDone={done} />
      )}
    </div>
  );
}

/** The projection chart of the selected goal and the sentence that explains it. */
function ProjectionCard({
  goal,
  asOf,
  canWrite,
  onEdit,
  onDelete,
}: {
  goal: GoalView;
  asOf: string;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('goals');
  const chart = goalChart(goal, asOf);
  const { result } = goal;
  const monthly = formatMoney(result.monthly, 'EUR');
  const scopeText = result.scopeNames.length
    ? result.scopeNames.join(', ')
    : t('note.allPortfolios');
  const scopeNote = t('note.scope', {
    scope: scopeText + (result.includesSavings ? t('note.withSavings') : ''),
  });
  const rate = formatPct(goal.rate ?? '0', { digits: 1 });

  let pace = '';
  if (result.mode === 'eta') {
    pace =
      result.etaMonth && result.reachIn !== null
        ? t('note.eta', { monthly, rate, month: monthYear(result.etaMonth) })
        : t('note.noContribution');
  } else if (result.mode === 'date' && result.projected) {
    const projected = formatMoney(result.projected, 'EUR');
    pace = t('note.projected', {
      monthly,
      rate,
      projected: perYear(goal) ? t('perYear', { value: projected }) : projected,
    });
  }

  return (
    <Card>
      <CardHeader
        title={t('chart.title', { name: goal.name })}
        actions={
          canWrite && (
            <span className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={onEdit}>
                <Pencil aria-hidden />
                {t('edit')}
              </Button>
              <Button variant="ghost" size="sm" aria-label={t('delete')} onClick={onDelete}>
                <Trash2 aria-hidden />
              </Button>
            </span>
          )
        }
      />
      {chart ? (
        <LineChart
          labels={chart.labels}
          series={[
            {
              name: t('chart.withMonthly', { value: monthly }),
              values: chart.planned,
              color: goal.color,
            },
            {
              name: t('chart.target'),
              values: chart.target,
              dash: true,
              fill: false,
              color: 'var(--fg-3)',
            },
          ]}
          label={t('chart.label')}
          periodHeader={t('chart.periodHeader')}
          empty={t('chart.empty')}
          height={260}
        />
      ) : (
        <p className="py-8 text-center text-sm text-fg-3">{t('chart.empty')}</p>
      )}
      <p className="rounded-sm bg-inset px-3.5 py-2.5 text-sm text-fg-2">
        {[pace, scopeNote].filter(Boolean).join(' ')}
      </p>
    </Card>
  );
}

function DeleteGoalDialog({
  poolId,
  goal,
  onClose,
  onDone,
}: {
  poolId: string;
  goal: GoalView;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('goals.confirmDelete');
  const action = useMemberAction(onDone);
  return (
    <FormDialog
      title={t('title')}
      submitLabel={t('confirm')}
      destructive
      action={action}
      onClose={onClose}
      onSubmit={() => {
        void action.run(() => sendJson('DELETE', poolApi(poolId, 'goals', goal.id)));
      }}
    >
      <p className="text-md text-fg-2">{t('text', { name: goal.name })}</p>
    </FormDialog>
  );
}
