'use client';

import { Button, cn, formatMoney } from '@nestvault/ui';
import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AnalysisTab } from '@webapp/components/portfolios/analysis-tab';
import { AssetDialog } from '@webapp/components/portfolios/asset-dialog';
import { AssetSheet } from '@webapp/components/portfolios/asset-sheet';
import { ConfirmDeleteDialog } from '@webapp/components/portfolios/confirm-delete-dialog';
import { CurrencyNotes, CurrencyPicker } from '@webapp/components/portfolios/currency-picker';
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
  chipMoney,
  PORTFOLIO_TABS,
  portfoliosPath,
  type PortfolioTab,
  toneClass,
  type PositionsGroup,
  withPlus,
  fractionPct,
} from '@webapp/lib/portfolios-view';

export interface PortfolioChip {
  /** Null for "Todos". */
  id: string | null;
  name: string;
  color: string;
  /** Value of the portfolio (a decimal string) in `currency`: its own, or the base for "Todos". */
  value: string;
  currency: string;
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
              href={portfoliosPath(poolId, chip.id, tab, group, ctx.currencyMode)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-panel',
                'pl-2.5 pr-3.5 text-md font-semibold text-fg-2 no-underline hover:text-fg',
                active && 'border-accent-2 text-fg shadow-[inset_0_0_0_1px_var(--accent-2)]',
              )}
            >
              <i
                aria-hidden
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: chip.id === null ? 'var(--grad-warm)' : chip.color }}
              />
              {chip.id === null ? t('all') : chip.name}
              <small className="text-xs font-medium text-fg-3">
                {chipMoney(chip.value, chip.currency)}
              </small>
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
            size="sm"
            onClick={() => {
              setDialog({ kind: 'portfolio', portfolioId });
            }}
          >
            <Pencil aria-hidden />
            {t('editPortfolio')}
          </Button>
        )}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line">
        <nav aria-label={t('tabsLabel')} className="overflow-x-auto pb-px">
          <ul className="m-0 flex list-none gap-5 p-0">
            {PORTFOLIO_TABS.filter((key) => key !== 'dividends' || ctx.data.hasDividends).map(
              (key) => (
                <li key={key}>
                  <Link
                    href={portfoliosPath(poolId, portfolioId, key, group, ctx.currencyMode)}
                    aria-current={key === tab ? 'page' : undefined}
                    className={cn(
                      '-mb-px block whitespace-nowrap border-b-2 pb-3 pt-2 text-md font-semibold no-underline',
                      key === tab
                        ? 'border-accent-2 text-fg'
                        : 'border-transparent text-fg-3 hover:text-fg',
                    )}
                  >
                    {t(`tabs.${key}`)}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
          {ctx.data.holdings.some((h) => h.isOpen) && (
            <span className="text-sm text-fg-3" title={t('dayGainHint')}>
              {t('dayGain')}{' '}
              <b className={cn('text-md font-semibold', toneClass(ctx.data.dayGain))}>
                {withPlus(
                  formatMoney(ctx.data.dayGain, ctx.data.display.currency),
                  ctx.data.dayGain,
                )}
              </b>{' '}
              <small className={toneClass(ctx.data.dayGain)}>
                {fractionPct(ctx.data.dayGainPct, true)}
              </small>
            </span>
          )}
          <CurrencyPicker ctx={ctx} tab={tab} group={group} />
        </div>
      </div>

      <CurrencyNotes ctx={ctx} />

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
            router.push(portfoliosPath(poolId, null, 'summary', 'asset', ctx.currencyMode));
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
