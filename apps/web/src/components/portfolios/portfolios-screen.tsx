'use client';

import { Button, Chip, cn, formatMoney } from '@nestvault/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AnalysisTab } from '@webapp/components/portfolios/analysis-tab';
import { AssetDialog } from '@webapp/components/portfolios/asset-dialog';
import { AssetSheet } from '@webapp/components/portfolios/asset-sheet';
import { ConfirmDeleteDialog } from '@webapp/components/portfolios/confirm-delete-dialog';
import { DividendsTab } from '@webapp/components/portfolios/dividends-tab';
import { MoveCashDialog } from '@webapp/components/portfolios/move-cash-dialog';
import { OpDialog } from '@webapp/components/portfolios/op-dialog';
import { PlanDialog } from '@webapp/components/portfolios/plan-dialog';
import { PortfolioDialog } from '@webapp/components/portfolios/portfolio-dialog';
import { PositionsTab } from '@webapp/components/portfolios/positions-tab';
import { SummaryTab } from '@webapp/components/portfolios/summary-tab';
import { TransactionsTab } from '@webapp/components/portfolios/transactions-tab';
import type { DialogRequest, TabContext } from '@webapp/components/portfolios/types';
import { poolApi } from '@webapp/lib/portfolio-forms';
import {
  PORTFOLIO_TABS,
  portfoliosPath,
  type PortfolioTab,
  type PositionsGroup,
} from '@webapp/lib/portfolios-view';

export interface PortfolioChip {
  /** Null for "Todos". */
  id: string | null;
  name: string;
  color: string;
  /** Value of the portfolio in EUR (a decimal string). */
  value: string;
}

export interface PortfoliosScreenProps {
  ctx: TabContext;
  chips: readonly PortfolioChip[];
  tab: PortfolioTab;
  group: PositionsGroup;
  /** Today in Lisbon (yyyy-mm-dd): the default date of new operations and prices. */
  today: string;
}

/**
 * The Portfolios screen: portfolio chips, tabs (in the URL, so a refresh keeps them) and the
 * dialogs. A dialog that changes data refreshes the server data without a full reload.
 */
export function PortfoliosScreen({ ctx, chips, tab, group, today }: PortfoliosScreenProps) {
  const t = useTranslations('portfolios');
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const { poolId, portfolioId } = ctx;

  const done = () => {
    setDialog(null);
    router.refresh();
  };
  const close = () => {
    setDialog(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t('chipsLabel')} className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const active = chip.id === portfolioId;
          return (
            <Link
              key={chip.id ?? 'all'}
              href={portfoliosPath(poolId, chip.id, tab, group)}
              aria-current={active ? 'page' : undefined}
              className="no-underline"
            >
              <Chip
                tone={chip.id === null ? 'warm' : 'default'}
                {...(chip.id === null ? {} : { dotColor: chip.color })}
                className={cn(
                  'h-[38px] px-4 text-md',
                  active && 'ring-2 ring-accent',
                  chip.id !== null && 'bg-panel text-fg',
                )}
              >
                {chip.id === null ? t('all') : chip.name}
                <span className="font-normal text-fg-3">{formatMoney(chip.value)}</span>
              </Chip>
            </Link>
          );
        })}
        {ctx.permissions.portfolios && (
          <Button
            variant="ghost"
            onClick={() => {
              setDialog({ kind: 'portfolio' });
            }}
          >
            <Plus aria-hidden />
            {t('newPortfolio')}
          </Button>
        )}
        {!!portfolioId && ctx.permissions.portfolios && (
          <Button
            variant="ghost"
            onClick={() => {
              setDialog({ kind: 'portfolio', portfolioId });
            }}
          >
            {t('editPortfolio')}
          </Button>
        )}
      </nav>

      <nav aria-label={t('tabsLabel')} className="overflow-x-auto border-b border-line pb-px">
        <ul className="m-0 flex list-none gap-5 p-0">
          {PORTFOLIO_TABS.map((key) => (
            <li key={key}>
              <Link
                href={portfoliosPath(poolId, portfolioId, key, group)}
                aria-current={key === tab ? 'page' : undefined}
                className={cn(
                  '-mb-px block whitespace-nowrap border-b-2 pb-3 text-md font-medium no-underline',
                  key === tab
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-2 hover:text-fg',
                )}
              >
                {t(`tabs.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'summary' && <SummaryTab ctx={ctx} open={setDialog} />}
      {tab === 'positions' && <PositionsTab ctx={ctx} group={group} open={setDialog} />}
      {tab === 'dividends' && <DividendsTab ctx={ctx} open={setDialog} />}
      {tab === 'transactions' && <TransactionsTab ctx={ctx} open={setDialog} />}
      {tab === 'analysis' && <AnalysisTab ctx={ctx} open={setDialog} />}

      {dialog?.kind === 'op' && (
        <OpDialog
          ctx={ctx}
          today={today}
          opId={dialog.opId}
          assetId={dialog.assetId}
          type={dialog.type}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'asset' && (
        <AssetDialog
          ctx={ctx}
          today={today}
          assetId={dialog.assetId}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'assetSheet' && (
        <AssetSheet
          ctx={ctx}
          assetId={dialog.assetId}
          today={today}
          open={setDialog}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'moveCash' && !!portfolioId && (
        <MoveCashDialog
          ctx={ctx}
          portfolioId={portfolioId}
          today={today}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'portfolio' && (
        <PortfolioDialog
          ctx={ctx}
          portfolioId={dialog.portfolioId}
          onClose={close}
          onDone={done}
          onDeleted={() => {
            setDialog(null);
            router.push(portfoliosPath(poolId, null));
            router.refresh();
          }}
        />
      )}
      {dialog?.kind === 'plan' && (
        <PlanDialog ctx={ctx} planId={dialog.planId} onClose={close} onDone={done} />
      )}
      {dialog?.kind === 'deleteOp' && (
        <ConfirmDeleteDialog
          kind="op"
          path={poolApi(poolId, 'ops', dialog.opId)}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'deletePlan' && (
        <ConfirmDeleteDialog
          kind="plan"
          path={poolApi(poolId, 'plans', dialog.planId)}
          onClose={close}
          onDone={done}
        />
      )}
    </div>
  );
}
