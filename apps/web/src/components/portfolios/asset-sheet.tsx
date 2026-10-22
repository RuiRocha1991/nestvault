'use client';

import { Button, Chip, formatDate, formatMoney, Input, Modal } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { NativeMoney } from '@webapp/components/portfolios/money';
import type { OpenDialog, TabContext } from '@webapp/components/portfolios/types';
import { normalizeDecimal, poolApi } from '@webapp/lib/portfolio-forms';
import { fractionPct, toneClass } from '@webapp/lib/portfolios-view';
import { postJson } from '@webapp/lib/post-json';
import { useMemberAction } from '@webapp/lib/use-member-action';

/** Modal 24: one asset: its position, its latest price (editable) and the shortcuts to trade it. */
export function AssetSheet({
  ctx,
  assetId,
  today,
  open,
  onClose,
  onDone,
}: {
  ctx: TabContext;
  assetId: string;
  today: string;
  open: OpenDialog;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portfolios.assetSheet');
  const priceId = useId();
  const asset = ctx.assetsById.get(assetId);
  const cur = ctx.data.display.currency;
  const holding = ctx.data.holdings.find((h) => h.assetId === assetId && h.isOpen);
  const [price, setPrice] = useState('');
  const [invalid, setInvalid] = useState(false);
  const action = useMemberAction(onDone);
  if (!asset) return null;

  function savePrice() {
    const value = normalizeDecimal(price);
    if (value === '') {
      setInvalid(true);
      return;
    }
    void action.run(() =>
      postJson(poolApi(ctx.poolId, 'assets', assetId, 'prices'), { date: today, price: value }),
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={asset.ticker}
      description={asset.name}
      closeLabel={t('close')}
      footer={
        <>
          {ctx.permissions.portfolios && (
            <Button
              variant="ghost"
              onClick={() => {
                open({ kind: 'asset', assetId });
              }}
            >
              {t('edit')}
            </Button>
          )}
          <span className="mr-auto" />
          {ctx.permissions.ops && (
            <>
              <Button
                onClick={() => {
                  open({ kind: 'op', assetId, type: 'sell' });
                }}
              >
                {t('sell')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  open({ kind: 'op', assetId, type: 'buy' });
                }}
              >
                {t('buy')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="accent">{t(`types.${asset.type}`)}</Chip>
        <Chip>{asset.currency}</Chip>
        {!!asset.sector && <Chip>{asset.sector}</Chip>}
        {!!asset.region && <Chip>{asset.region}</Chip>}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-md">
        <dt className="text-fg-3">{t('price')}</dt>
        <dd className="text-right">
          {asset.price === null ? (
            t('noPrice')
          ) : (
            <>
              {formatMoney(asset.price, asset.currency)}
              {!!asset.priceDate && (
                <small className="block text-xs text-fg-3">{formatDate(asset.priceDate)}</small>
              )}
            </>
          )}
        </dd>
        <dt className="text-fg-3">{t('dividend')}</dt>
        <dd className="text-right">
          {asset.dps === null || Number(asset.dps) === 0
            ? t('none')
            : t('dividendPerYear', {
                dps: formatMoney(asset.dps, asset.currency),
                times: asset.divMonths.length,
              })}
        </dd>
        {!!holding && (
          <>
            <dt className="text-fg-3">{t('qty')}</dt>
            <dd className="text-right">
              {Number(holding.qty).toLocaleString('pt-PT', { maximumFractionDigits: 4 })}
            </dd>
            <dt className="text-fg-3">{t('avgPrice')}</dt>
            <dd className="text-right">{formatMoney(holding.avg, holding.currency)}</dd>
            <dt className="text-fg-3">{t('value')}</dt>
            <dd className="text-right">
              <NativeMoney
                native={holding.valueN}
                converted={holding.value}
                displayCurrency={cur}
                currency={holding.currency}
              />
            </dd>
            <dt className="text-fg-3">{t('gain')}</dt>
            <dd className="text-right">
              <NativeMoney
                native={holding.gainN}
                converted={holding.gain}
                displayCurrency={cur}
                currency={holding.currency}
                signed
              />
              <small className={`block text-xs ${toneClass(holding.gain)}`}>
                {fractionPct(holding.gainPct, true)}
              </small>
            </dd>
          </>
        )}
      </dl>

      {ctx.permissions.portfolios && (
        <form
          noValidate
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!action.busy) savePrice();
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor={priceId} className="text-sm font-medium text-fg-2">
              {t('newPrice', { currency: asset.currency })}
            </label>
            <Input
              id={priceId}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={invalid}
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                setInvalid(false);
                action.clearProblem();
              }}
            />
          </div>
          <Button type="submit" disabled={action.busy}>
            {t('savePrice')}
          </Button>
        </form>
      )}
      {action.problem !== null && <p className="text-sm text-neg">{t('priceError')}</p>}
    </Modal>
  );
}
