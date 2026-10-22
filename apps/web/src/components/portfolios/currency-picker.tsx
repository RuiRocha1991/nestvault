'use client';

import { formatDate, formatMoney, Segmented } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { TabContext } from '@webapp/components/portfolios/types';
import {
  portfoliosPath,
  type CurrencyMode,
  type PortfolioTab,
  type PositionsGroup,
} from '@webapp/lib/portfolios-view';

/**
 * "Moeda do portfolio" / "Moeda base": the currency of every figure of the screen. The choice is
 * in the URL (`?moeda=`) so a refresh, a link and the other tabs keep it. All portfolios mix
 * currencies, so there the base currency is fixed. Under it, the rates used, with source and date.
 */
export function CurrencyPicker({
  ctx,
  tab,
  group,
}: {
  ctx: TabContext;
  tab: PortfolioTab;
  group: PositionsGroup;
}) {
  const t = useTranslations('portfolios.currency');
  const router = useRouter();
  const { display } = ctx.data;

  return (
    <Segmented<CurrencyMode>
      label={t('label')}
      value={display.mode}
      disabled={display.fixed}
      onChange={(mode) => {
        router.push(portfoliosPath(ctx.poolId, ctx.portfolioId, tab, group, mode));
      }}
      options={[
        { value: 'portfolio', label: t('portfolio') },
        { value: 'base', label: t('base') },
      ]}
    />
  );
}

/** Why the choice is fixed, and the rates the figures were converted with (source and date). */
export function CurrencyNotes({ ctx }: { ctx: TabContext }) {
  const t = useTranslations('portfolios.currency');
  const tp = useTranslations('parameters');
  const { display } = ctx.data;
  if (!display.fixed && display.rates.length === 0) return null;

  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-3">
      {display.fixed && <span>{t('fixedHint', { currency: display.baseCurrency })}</span>}
      {display.rates.map((rate) => (
        <span key={rate.currency}>
          {t('rate', {
            from: formatMoney(1, rate.currency, { digits: 0 }),
            rate: formatMoney(rate.rate, 'EUR', { digits: 4 }),
          })}
          {' · '}
          {rate.date === null
            ? tp(`fxSource.${rate.source}`)
            : tp('fxSourceDate', {
                source: tp(`fxSource.${rate.source}`),
                date: formatDate(rate.date),
              })}
        </span>
      ))}
    </p>
  );
}
