import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ProgressBar,
  formatDate,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { KeyRow, Stat } from '@webapp/components/real-estate/parts';
import { camelKey, type WorkListView, type WorkView } from '@webapp/lib/real-estate-view';

const STATUS_TONE = { done: 'pos', in_progress: 'warn', planned: 'default' } as const;

function ProjectCard({ project }: { project: WorkView }) {
  const t = useTranslations('realEstate.works');
  const { totals } = project;
  const planned = Number(totals.planned);
  const paidPct = planned > 0 ? (Number(totals.paid) / planned) * 100 : 0;
  return (
    <Card aria-label={project.name}>
      <div className="flex items-start gap-2">
        <h3 className="mr-auto text-lg font-semibold">{project.name}</h3>
        <Chip tone={STATUS_TONE[project.status]}>{t(`status.${camelKey(project.status)}`)}</Chip>
      </div>
      {(!!project.description || !!project.supplier) && (
        <p className="text-sm text-fg-3">
          {project.description}
          {!!project.description && !!project.supplier && ' · '}
          {!!project.supplier && <b className="text-fg-2">{project.supplier}</b>}
        </p>
      )}
      <dl className="flex flex-col gap-1.5">
        <KeyRow label={t('budget')}>{formatMoney(project.budget)}</KeyRow>
        {!!project.depositPct && !!project.depositAmount && (
          <KeyRow label={t('deposit')}>
            {`${formatPct(project.depositPct, { digits: 0 })} · ${formatMoney(project.depositAmount)}`}
          </KeyRow>
        )}
        <KeyRow label={t('paid')} tone="pos">
          {formatMoney(totals.paid)}
        </KeyRow>
        <KeyRow label={t('outstanding')}>{formatMoney(totals.outstanding)}</KeyRow>
      </dl>
      <ProgressBar value={paidPct} label={t('progress', { name: project.name })} />
      {project.phases.length > 0 && (
        <section aria-label={t('phases')} className="flex flex-col">
          <h4 className="border-b border-line pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
            {t('phases')}
          </h4>
          <ul className="m-0 flex list-none flex-col p-0">
            {project.phases.map((phase) => (
              <li
                key={phase.id}
                className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
              >
                <div className="mr-auto flex min-w-0 flex-col">
                  <b className="text-sm">{phase.description}</b>
                  <span className="text-xs text-fg-3">
                    {phase.plannedDate && t('plannedOn', { date: formatDate(phase.plannedDate) })}
                    {phase.paidDate && ` · ${t('paidOn', { date: formatDate(phase.paidDate) })}`}
                    {phase.delayDays !== null &&
                      phase.delayDays !== 0 &&
                      ` (${phase.delayDays > 0 ? '+' : ''}${phase.delayDays} ${t('days')})`}
                  </span>
                </div>
                <b className="tabular-nums">{formatMoney(phase.amount)}</b>
                <Chip tone={phase.status === 'paid' ? 'pos' : 'default'}>
                  {t(`phase.${phase.status}`)}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!project.notes && (
        <p className="rounded-sm bg-inset p-3 text-sm text-fg-2">{project.notes}</p>
      )}
    </Card>
  );
}

/** Mockup 31: the summary strip and one card per project with its payment phases. */
export function WorksTab({ works, propertyId }: { works: WorkListView; propertyId: string }) {
  const t = useTranslations('realEstate.works');
  const summary = works.byProperty.find((row) => row.propertyId === propertyId);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('summaryTitle')} subtitle={t('summaryText')} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label={t('budgeted')}>{formatMoney(summary?.budget ?? '0')}</Stat>
          <Stat label={t('paid')} tone="pos">
            {formatMoney(summary?.paid ?? '0')}
          </Stat>
          <Stat label={t('debt')}>{formatMoney(summary?.outstanding ?? '0')}</Stat>
          <Stat label={t('doneCount')}>{summary?.byStatus.done ?? 0}</Stat>
          <Stat label={t('ongoing')}>{summary?.byStatus.in_progress ?? 0}</Stat>
        </div>
      </Card>
      {works.projects.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {works.projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
