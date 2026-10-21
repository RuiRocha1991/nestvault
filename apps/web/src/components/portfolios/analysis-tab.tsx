'use client';

import {
  Button,
  Card,
  CardHeader,
  Chip,
  Donut,
  EmptyState,
  ProgressBar,
  seriesColor,
} from '@nestvault/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import { fractionPct } from '@webapp/lib/portfolios-view';

type Dimension = 'type' | 'sector' | 'region' | 'currency';
const DIMENSIONS: readonly Dimension[] = ['type', 'sector', 'region', 'currency'];

/** Mockup 07: the diagnostic, the allocation donuts and the target allocation. */
export function AnalysisTab({ ctx, open }: { ctx: TabContext; open: OpenDialog }) {
  const t = useTranslations('portfolios.analysis');
  const { data } = ctx;
  const openHoldings = data.holdings.filter((h) => h.isOpen);
  const portfolio = ctx.portfolios.find((p) => p.id === ctx.portfolioId);
  const targets = Object.entries(portfolio?.targets ?? {});

  if (openHoldings.length === 0) {
    return (
      <Card>
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      </Card>
    );
  }

  const label = (dimension: Dimension, name: string) => {
    if (name === '') return t('none');
    return dimension === 'type' ? t(`types.${name}`) : name;
  };

  // The weight of what a target names: an asset type or a ticker.
  const actualWeight = (name: string) =>
    openHoldings
      .filter((h) => {
        const asset = ctx.assetsById.get(h.assetId);
        return asset?.type === name || asset?.ticker === name;
      })
      .reduce((total, h) => total + Number(h.weight), 0);

  return (
    <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      <Card className="col-span-2 max-[900px]:col-span-1">
        <CardHeader title={t('diagnostic')} />
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.diagnostics.map((d) => {
            const ticker = d.assetId ? (ctx.assetsById.get(d.assetId)?.ticker ?? '') : '';
            const weight = fractionPct(d.weight ?? '0');
            return (
              <li key={d.code} className="flex items-start gap-3 text-md">
                <Chip tone={d.bad ? 'warn' : 'pos'}>{d.bad ? t('attention') : t('ok')}</Chip>
                <span>
                  {t(`checks.${d.code}.title`, {
                    ticker,
                    weight,
                    positions: d.positions ?? 0,
                    sectors: d.sectors ?? 0,
                    regions: d.regions ?? 0,
                  })}
                  <span className="block text-sm text-fg-3">
                    {t(`checks.${d.code}.${d.bad ? 'bad' : 'good'}`)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {DIMENSIONS.map((dimension) => {
        const segments = data.allocation[dimension].map((slice, index) => ({
          name: label(dimension, slice.name),
          value: Number(slice.value),
          color: seriesColor(index),
        }));
        return (
          <Card key={dimension}>
            <CardHeader title={t(`dimensions.${dimension}`)} headingLevel={3} />
            <Donut
              segments={segments}
              label={t(`dimensions.${dimension}`)}
              centerValue={String(segments.length)}
              size={120}
              stroke={14}
            />
          </Card>
        );
      })}

      {!!portfolio && (
        <Card className="col-span-2 max-[900px]:col-span-1">
          <CardHeader
            title={t('targets.title')}
            actions={
              ctx.permissions.portfolios && (
                <Button
                  size="sm"
                  onClick={() => {
                    open({ kind: 'portfolio', portfolioId: portfolio.id });
                  }}
                >
                  <Pencil aria-hidden />
                  {t('targets.edit')}
                </Button>
              )
            }
          />
          {targets.length === 0 ? (
            <p className="text-fg-3">{t('targets.empty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {targets.map(([name, target]) => {
                const actual = actualWeight(name) * 100;
                return (
                  <li key={name} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <b>{label('type', name)}</b>
                      <span className="text-fg-2">
                        {t('targets.actualOfTarget', {
                          actual: fractionPct(String(actual / 100)),
                          target: fractionPct(String(Number(target) / 100)),
                        })}
                      </span>
                    </div>
                    <ProgressBar
                      value={Number(target) > 0 ? (actual / Number(target)) * 100 : 0}
                      label={name}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
