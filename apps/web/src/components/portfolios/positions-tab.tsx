'use client';

import {
  Button,
  Card,
  Chip,
  EmptyState,
  formatMoney,
  formatNumber,
  Segmented,
  Table,
  Td,
  Th,
} from '@nestvault/ui';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { NativeMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import type { HoldingView } from '@webapp/lib/portfolios-types';
import {
  daysBetween,
  fractionPct,
  groupByAccount,
  portfoliosPath,
  STALE_PRICE_DAYS,
  sumMoney,
  toneClass,
  type PositionsGroup,
} from '@webapp/lib/portfolios-view';
import { postJson } from '@webapp/lib/post-json';

const COLUMNS = 11;
type SortKey =
  | 'asset'
  | 'qty'
  | 'avg'
  | 'price'
  | 'value'
  | 'day'
  | 'gain'
  | 'divs'
  | 'total'
  | 'yld'
  | 'weight';

/** Mockups 03, 04 and 08: positions merged per asset, or per account and sub-account. */
export function PositionsTab({
  ctx,
  group,
  open,
}: {
  ctx: TabContext;
  group: PositionsGroup;
  open: OpenDialog;
}) {
  const t = useTranslations('portfolios.positions');
  const router = useRouter();
  const { data, poolId, portfolioId } = ctx;
  const cur = data.display.currency;
  const dividends = data.hasDividends;

  const source = group === 'asset' ? data.holdings : data.positions;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const tickerOf = (h: HoldingView) => ctx.assetsById.get(h.assetId)?.ticker ?? '';
  const rows = source
    .filter((h) => h.isOpen)
    .sort((a, b) => {
      if (sort.key === 'asset') return tickerOf(a).localeCompare(tickerOf(b)) * sort.dir;
      return (Number(a[sort.key]) - Number(b[sort.key])) * sort.dir;
    });
  /** A column header that sorts by its column (a second click flips the direction). */
  const sortTh = (key: SortKey, label: string, numeric = true) => (
    <Th numeric={numeric}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1 hover:text-fg"
        aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
        onClick={() => {
          setSort((current) =>
            current.key === key
              ? { key, dir: current.dir === 1 ? -1 : 1 }
              : { key, dir: key === 'asset' ? 1 : -1 },
          );
        }}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? ' ↑' : ' ↓')}
      </button>
    </Th>
  );
  const total = rows.reduce((sum, h) => sum + Math.round(Number(h.value) * 100), 0) / 100;

  const accountName = (id: string | null) =>
    id === null ? t('noAccount') : (ctx.accounts.find((a) => a.id === id)?.name ?? t('noAccount'));
  const subAccountName = (h: HoldingView) =>
    ctx.accounts.flatMap((a) => a.subAccounts).find((s) => s.id === h.subAccountId)?.name ?? null;

  function row(h: HoldingView) {
    const asset = ctx.assetsById.get(h.assetId);
    return (
      <tr
        key={h.key}
        tabIndex={0}
        className="cursor-pointer hover:bg-panel-2"
        onClick={() => {
          open({ kind: 'assetSheet', assetId: h.assetId });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open({ kind: 'assetSheet', assetId: h.assetId });
        }}
      >
        <Td>
          <AssetCell ticker={asset?.ticker ?? ''} name={asset?.name} type={asset?.type} />
          {group === 'account' && !!subAccountName(h) && (
            <small className="ml-[42px] block text-xs text-fg-3">{subAccountName(h)}</small>
          )}
        </Td>
        <Td numeric>{Number(h.qty).toLocaleString('pt-PT', { maximumFractionDigits: 4 })}</Td>
        <Td numeric>
          {formatNumber(h.avg)} <small className="inline text-xs text-fg-3">{h.currency}</small>
        </Td>
        <Td numeric>
          {formatNumber(h.price)} <small className="inline text-xs text-fg-3">{h.currency}</small>
          {!!asset?.priceDate && daysBetween(asset.priceDate, data.asOf) > STALE_PRICE_DAYS && (
            <small className="block text-xs text-warn">{t('stale')}</small>
          )}
        </Td>
        <Td numeric>
          <b>
            <NativeMoney
              native={h.valueN}
              converted={h.value}
              displayCurrency={cur}
              currency={h.currency}
            />
          </b>
        </Td>
        <Td numeric>
          <NativeMoney
            native={h.dayN}
            converted={h.day}
            displayCurrency={cur}
            currency={h.currency}
            signed
          />
          <small className={`block text-xs ${toneClass(h.day)}`}>
            {fractionPct(h.dayPct, true)}
          </small>
        </Td>
        <Td numeric>
          <NativeMoney
            native={h.gainN}
            converted={h.gain}
            displayCurrency={cur}
            currency={h.currency}
            signed
          />
          <small className={`block text-xs ${toneClass(h.gain)}`}>
            {fractionPct(h.gainPct, true)}
          </small>
        </Td>
        {dividends && (
          <Td numeric>
            {Number(h.divsN) === 0 ? (
              <span className="text-fg-3">{t('none')}</span>
            ) : (
              <NativeMoney
                native={h.divsN}
                converted={h.divs}
                displayCurrency={cur}
                currency={h.currency}
              />
            )}
          </Td>
        )}
        <Td numeric>
          <NativeMoney
            native={h.totalN}
            converted={h.total}
            displayCurrency={cur}
            currency={h.currency}
            signed
          />
          <small className={`block text-xs ${toneClass(h.total)}`}>
            {fractionPct(
              Number(h.cost) === 0 ? '0' : String(Number(h.total) / Number(h.cost)),
              true,
            )}
          </small>
        </Td>
        {dividends && (
          <Td numeric>
            {Number(h.income) === 0 ? (
              <span className="text-fg-3">{t('none')}</span>
            ) : (
              <>
                {fractionPct(h.yld)}
                <small className="block text-xs text-fg-3">
                  {t('yoc', { value: fractionPct(h.yoc) })}
                </small>
              </>
            )}
          </Td>
        )}
        <Td numeric>{fractionPct(h.weight)}</Td>
      </tr>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t('group')}
            value={group}
            onChange={(value) => {
              router.push(
                portfoliosPath(poolId, portfolioId, 'positions', value, ctx.currencyMode),
              );
            }}
            options={[
              { value: 'asset', label: t('byAsset') },
              { value: 'account', label: t('byAccount') },
            ]}
          />
          <span className="mr-auto text-sm text-fg-3">
            {t(group === 'asset' ? 'countByAsset' : 'countByAccount', {
              count: rows.length,
              total: formatMoney(total, cur),
            })}
          </span>
          {ctx.permissions.portfolios && (
            <Button
              onClick={() => {
                open({ kind: 'asset' });
              }}
            >
              <Plus aria-hidden />
              {t('newAsset')}
            </Button>
          )}
          {ctx.permissions.ops && (
            <Button
              variant="primary"
              onClick={() => {
                open({ kind: 'op' });
              }}
            >
              <Plus aria-hidden />
              {t('newTransaction')}
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t(dividends ? 'emptyText' : 'emptyTextNoDividends')}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                {sortTh('asset', t('asset'), false)}
                {sortTh('qty', t('qty'))}
                {sortTh('avg', t('avgPrice'))}
                {sortTh('price', t('price'))}
                {sortTh('value', t('value'))}
                {sortTh('day', t('day'))}
                {sortTh('gain', t('capitalGain'))}
                {dividends && sortTh('divs', t('dividends'))}
                {sortTh('total', t('totalReturn'))}
                {dividends && sortTh('yld', t('yield'))}
                {sortTh('weight', t('weight'))}
              </tr>
            </thead>
            <tbody>
              {group === 'asset'
                ? rows.map(row)
                : groupByAccount(rows).flatMap((accountGroup) => [
                    <tr key={`head-${accountGroup.accountId ?? 'none'}`}>
                      <Td
                        colSpan={dividends ? COLUMNS : COLUMNS - 2}
                        className="bg-panel-2 text-sm font-semibold text-fg-2"
                      >
                        {accountName(accountGroup.accountId)}
                      </Td>
                    </tr>,
                    ...accountGroup.rows.map(row),
                  ])}
            </tbody>
          </Table>
        )}
      </Card>
      <PlansCard ctx={ctx} open={open} />
    </div>
  );
}

/** "Investimentos regulares": the monthly plans of the scope and the button that registers one. */
function PlansCard({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.plans');
  const router = useRouter();
  const plans = ctx.portfolioId
    ? ctx.plans.filter((plan) => plan.portfolioId === ctx.portfolioId)
    : ctx.plans;
  const month = ctx.data.asOf.slice(0, 7);
  const registered = new Set(
    ctx.data.ops.filter((op) => op.planId && op.date.startsWith(month)).map((op) => op.planId),
  );

  async function run(planId: string) {
    const response = await postJson(
      `/api/v1/pools/${encodeURIComponent(ctx.poolId)}/plans/${encodeURIComponent(planId)}/run`,
      {},
    );
    if (response.ok) router.refresh();
  }

  return (
    <Card>
      <header className="flex items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{t('title')}</h2>
        {ctx.permissions.portfolios && (
          <Button
            size="sm"
            onClick={() => {
              open({ kind: 'plan' });
            }}
          >
            <Plus aria-hidden />
            {t('new')}
          </Button>
        )}
      </header>
      {plans.length === 0 ? (
        <p className="text-fg-3">{t('empty')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('asset')}</Th>
              <Th>{t('portfolio')}</Th>
              <Th numeric>{t('amount')}</Th>
              <Th numeric>{t('day')}</Th>
              <Th>{t('thisMonth')}</Th>
              <Th numeric>{t('invested')}</Th>
              <Th>
                <span className="sr-only">{t('actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              const asset = ctx.assetsById.get(plan.assetId);
              const done = registered.has(plan.id);
              return (
                <tr key={plan.id}>
                  <Td>
                    <AssetCell ticker={asset?.ticker ?? ''} type={asset?.type} compact />
                  </Td>
                  <Td className="text-fg-2">
                    {ctx.portfolios.find((p) => p.id === plan.portfolioId)?.name ?? ''}
                  </Td>
                  <Td numeric>{formatMoney(plan.amount)}</Td>
                  <Td numeric>{plan.day}</Td>
                  <Td>
                    <Chip tone={done ? 'pos' : 'default'}>
                      {t(!plan.active ? 'paused' : done ? 'registered' : 'scheduled')}
                    </Chip>
                  </Td>
                  <Td numeric>
                    {formatMoney(
                      sumMoney(
                        ctx.data.ops
                          .filter((op) => op.planId === plan.id && op.type === 'buy')
                          .map((op) =>
                            op.converted.startsWith('-') ? op.converted.slice(1) : op.converted,
                          ),
                      ),
                      ctx.data.display.currency,
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {ctx.permissions.ops && plan.active && !done && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void run(plan.id);
                        }}
                      >
                        <Play aria-hidden />
                        {t('register')}
                      </Button>
                    )}
                    {ctx.permissions.portfolios && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon
                          aria-label={t('edit')}
                          onClick={() => {
                            open({ kind: 'plan', planId: plan.id });
                          }}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon
                          aria-label={t('delete')}
                          onClick={() => {
                            open({ kind: 'deletePlan', planId: plan.id });
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
