'use client';

import { Button, Chip, Select, formatDate, formatMoney } from '@nestvault/ui';
import { Info, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { Alert } from '@webapp/components/auth/alert';
import { Field } from '@webapp/components/auth/field';
import type { AccountCard, PortfolioOption } from '@webapp/lib/accounts-types';
import { categoryMessageKey } from '@webapp/lib/category-name';
import type { CategoryView } from '@webapp/lib/expenses-types';
import type { ImportPreview } from '@webapp/lib/imports-types';
import {
  commitBody,
  confidenceLevel,
  eligibleAccounts,
  newAssetsFor,
  newCount,
  periodOf,
  type AssetKind,
} from '@webapp/lib/imports-view';

import { PreviewTable } from './preview-table';

export interface PreviewStepProps {
  preview: ImportPreview;
  accounts: readonly AccountCard[];
  portfolios: readonly PortfolioOption[];
  categories: readonly CategoryView[];
  /** The account the lines are for (`''` until one is chosen). */
  accountId: string;
  busy: boolean;
  onAccount: (accountId: string) => void;
  onConfirm: (body: unknown) => void;
  onCancel: () => void;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col gap-1 rounded-md border border-line bg-inset px-3 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-3">{label}</span>
      <b className="text-lg tabular-nums">{children}</b>
    </div>
  );
}

/**
 * The step after detection: the format banner, the account, the strip of figures (read, new,
 * duplicates, period, reconciliation), the first lines with their predicted category, the options
 * and the confirm button. Nothing is saved until the button is pressed; at 0 new lines it is off.
 */
export function PreviewStep({
  preview,
  accounts,
  portfolios,
  categories,
  accountId,
  busy,
  onAccount,
  onConfirm,
  onCancel,
}: PreviewStepProps) {
  const t = useTranslations('imports');
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;

  const [adjustOpeningBalance, setAdjust] = useState(false);
  const [portfolioId, setPortfolio] = useState('');
  const [assetTypes, setAssetTypes] = useState<Record<string, AssetKind>>({});
  const [subAccounts, setSubAccounts] = useState<Record<string, string>>({});

  const fitting = eligibleAccounts(accounts, preview.kind);
  const account = fitting.find((one) => one.id === accountId);
  const level = confidenceLevel(preview.parser.confidence);
  const parserKey = categoryMessageKey(preview.parser.parserId);
  const parserName = t.has(`parsers.${parserKey}`)
    ? t(`parsers.${parserKey}`)
    : preview.parser.parserId;

  const hasAccount = !!account && preview.accountId === account.id;
  const fresh = newCount(preview);
  const period = periodOf(preview);
  const missingPortfolio =
    preview.kind === 'broker' &&
    !(account?.portfolioId ?? preview.broker?.portfolioId) &&
    !portfolioId;
  const canConfirm = hasAccount && fresh > 0 && !busy && !missingPortfolio;
  const newAssets = preview.kind === 'broker' ? newAssetsFor(preview, assetTypes) : [];

  const reconciliation =
    preview.reconciled === null
      ? t('summary.notAvailable')
      : preview.reconciled
        ? t('summary.reconciled')
        : t('summary.notReconciled');

  function confirm() {
    onConfirm(
      commitBody(preview, {
        accountId,
        adjustOpeningBalance,
        portfolioId,
        assetTypes,
        subAccounts,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">
          {t('detected.banner', { parser: parserName, level: t(`confidence.${level}`) })}
        </Chip>
        {preview.remembered && (
          <span className="text-sm text-fg-3">{t('detected.remembered')}</span>
        )}
      </div>

      <Field id={id('account')} label={t('account.label')}>
        <Select
          id={id('account')}
          value={accountId}
          disabled={busy}
          onChange={(event) => {
            onAccount(event.target.value);
          }}
        >
          <option value="">{t('account.placeholder')}</option>
          {fitting.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </Select>
        <p className="m-0 text-sm text-fg-3">
          {fitting.length === 0
            ? t('account.none')
            : preview.kind === 'bank'
              ? t('account.bankHint')
              : t('account.brokerHint')}
        </p>
      </Field>

      {!!preview.duplicateFile && (
        <Alert tone="warning" icon={<TriangleAlert aria-hidden />}>
          {t('alerts.duplicateFile', { date: formatDate(preview.duplicateFile.committedAt) })}
        </Alert>
      )}
      {preview.warnings.length > 0 && (
        <Alert tone="info" icon={<Info aria-hidden />}>
          <b>{t('alerts.warnings')}</b>
          <ul className="m-0 list-disc pl-5">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap gap-3" aria-label={t('summary.read')} role="group">
        <Stat label={t('summary.read')}>{preview.summary.total}</Stat>
        <Stat label={t('summary.new')}>
          {preview.accountId ? preview.summary.new : t('summary.unknown')}
        </Stat>
        <Stat label={t('summary.duplicates')}>
          {preview.summary.duplicates ?? t('summary.unknown')}
        </Stat>
        {preview.summary.skipped > 0 && (
          <Stat label={t('summary.skipped')}>{preview.summary.skipped}</Stat>
        )}
        <Stat label={t('summary.period')}>
          {period
            ? t('summary.periodRange', { from: formatDate(period[0]), to: formatDate(period[1]) })
            : t('summary.unknown')}
        </Stat>
        <Stat label={t('summary.reconciliation')}>
          <span className="text-md">{reconciliation}</span>
        </Stat>
      </div>

      {!hasAccount && <p className="m-0 text-sm text-fg-3">{t('account.needed')}</p>}
      {hasAccount && fresh === 0 && (
        <Alert tone="info" icon={<Info aria-hidden />}>
          {t('alerts.allDuplicates')}
        </Alert>
      )}

      <PreviewTable preview={preview} categories={categories} />

      {preview.kind === 'bank' && preview.closingBalance !== null && (
        <label className="flex items-start gap-2 text-md">
          <input
            type="checkbox"
            className="mt-1"
            checked={adjustOpeningBalance}
            onChange={(event) => {
              setAdjust(event.target.checked);
            }}
          />
          <span>
            {t('options.adjustOpening')}
            <span className="block text-sm text-fg-3">
              {t('options.adjustOpeningHint', {
                balance: formatMoney(preview.closingBalance, account?.currency ?? 'EUR'),
              })}
            </span>
          </span>
        </label>
      )}

      {preview.kind === 'broker' && preview.broker && (
        <div className="flex flex-col gap-4">
          {!(account?.portfolioId ?? preview.broker.portfolioId) && (
            <Field id={id('portfolio')} label={t('options.portfolio')}>
              <Select
                id={id('portfolio')}
                value={portfolioId}
                onChange={(event) => {
                  setPortfolio(event.target.value);
                }}
              >
                <option value="">{t('options.portfolioPlaceholder')}</option>
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>
                    {portfolio.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {newAssets.length > 0 && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold text-fg-2">
                {t('options.newAssets')}
              </legend>
              <p className="m-0 text-sm text-fg-3">{t('options.newAssetsHint')}</p>
              {newAssets.map((asset) => (
                <div key={asset.symbol} className="flex items-center gap-3">
                  <span className="min-w-[120px] font-semibold">{asset.symbol}</span>
                  <Select
                    compact
                    aria-label={t('options.assetType', { symbol: asset.symbol })}
                    value={asset.type}
                    onChange={(event) => {
                      setAssetTypes({
                        ...assetTypes,
                        [asset.symbol]: event.target.value as AssetKind,
                      });
                    }}
                  >
                    <option value="stock">{t('options.stock')}</option>
                    <option value="etf">{t('options.etf')}</option>
                  </Select>
                </div>
              ))}
            </fieldset>
          )}
          {preview.broker.holders.length > 0 && !!account && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold text-fg-2">
                {t('options.holders')}
              </legend>
              {preview.broker.holders.map((holder) => (
                <div key={holder.holder} className="flex items-center gap-3">
                  <span className="min-w-[120px] font-semibold">{holder.holder}</span>
                  <Select
                    compact
                    aria-label={t('options.holderSub', { holder: holder.holder })}
                    value={subAccounts[holder.holder] ?? holder.subAccountId ?? ''}
                    onChange={(event) => {
                      setSubAccounts({ ...subAccounts, [holder.holder]: event.target.value });
                    }}
                  >
                    <option value="">{t('options.noSubAccount')}</option>
                    {account.subAccounts.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </fieldset>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {hasAccount && (
          <Chip tone={fresh === 0 ? 'warn' : 'pos'}>{t('summary.newCount', { n: fresh })}</Chip>
        )}
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button variant="primary" disabled={!canConfirm} onClick={confirm}>
          {busy ? t('actions.confirming') : t('actions.confirm', { n: fresh })}
        </Button>
      </div>
    </div>
  );
}
