'use client';

import {
  Button,
  Card,
  Chip,
  Eyebrow,
  ProgressBar,
  cn,
  formatDate,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type {
  AccountCard as AccountCardDto,
  BrokerageFigures as BrokerageDto,
  TermDeposit as TermDepositDto,
} from '@webapp/lib/accounts-types';
import { balanceText, holderNames, tileBackground, TYPE_META } from '@webapp/lib/accounts-view';

type Translate = ReturnType<typeof useTranslations<'accounts'>>;

export interface AccountCardProps {
  account: AccountCardDto;
  holders: readonly { id: string; name: string }[];
  /** Every account, to name where the interest goes and where the capital returns. */
  accountNames: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, string>;
  portfolioName: string | null;
  /** Edit, delete and add interest are hidden without `accounts.write` (the server checks again). */
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddInterest: () => void;
  onRemoveInterest: (id: string, date: string) => void;
}

function Kv({ children }: { children: ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-md">
      {children}
    </dl>
  );
}

function Row({
  label,
  tone,
  indent,
  children,
}: {
  label: ReactNode;
  tone?: 'pos' | 'neg' | undefined;
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className={cn('m-0 text-fg-3', indent && 'pl-3')}>{label}</dt>
      <dd
        className={cn(
          'm-0 text-right font-medium tabular-nums',
          tone === 'pos' && 'text-pos',
          tone === 'neg' && 'text-neg',
        )}
      >
        {children}
      </dd>
    </>
  );
}

/** `a cada 3 meses`, `só no fim`. */
function periodText(t: Translate, n: number | null, unit: 'm' | 'd' | null): string {
  if (n === null || unit === null) return t('period.atEnd');
  return t(unit === 'm' ? 'period.months' : 'period.days', { n });
}

function InterestBlock({
  account,
  canWrite,
  onRemove,
}: {
  account: AccountCardDto;
  canWrite: boolean;
  onRemove: (id: string, date: string) => void;
}) {
  const t = useTranslations('accounts');
  const interest = account.interest;
  if (!interest) return null;
  const { currency } = account;
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>{t('card.lastInterest')}</Eyebrow>
      {interest.recent.length === 0 && (
        <span className="text-sm text-fg-3">{t('card.noInterest')}</span>
      )}
      {interest.recent.map((row) => (
        <div key={row.id} className="flex min-h-7 items-center gap-2 text-sm">
          <span className="tabular-nums text-fg-3">{formatDate(row.date)}</span>
          <Chip className="h-[18px]">
            {row.source === 'manual' ? t('card.interestManual') : t('card.interestStatement')}
          </Chip>
          <b className="ml-auto tabular-nums text-pos">{`+${formatMoney(row.amount, currency)}`}</b>
          {canWrite && row.source === 'manual' && (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('card.removeInterest', { date: formatDate(row.date) })}
              onClick={() => {
                onRemove(row.id, row.date);
              }}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function TermBody({
  term,
  accountNames,
  products,
}: {
  term: TermDepositDto;
  accountNames: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('accounts');
  const product = term.productId ? products.get(term.productId) : undefined;
  const payTo = term.payToAccountId ? accountNames.get(term.payToAccountId) : undefined;
  const back = term.returnToAccountId ? accountNames.get(term.returnToAccountId) : undefined;
  const eur = (value: string) => formatMoney(value);
  return (
    <>
      <Kv>
        {!!product && <Row label={t('card.product')}>{product}</Row>}
        <Row label={t('card.capital')}>{eur(term.capital)}</Row>
        <Row label={t('card.tanb')}>{formatPct(term.rate, { digits: 2 })}</Row>
        {term.scheduled && (
          <>
            <Row label={t('card.paysInterest')}>
              {t('period.every', { period: periodText(t, term.payN, term.payU) })}
            </Row>
          </>
        )}
        <Row label={t('card.interestTax')}>{formatPct(term.tax, { digits: 1 })}</Row>
        {term.scheduled && (
          <Row label={t('card.interestGoesTo')}>{payTo ?? t('card.capitalizes')}</Row>
        )}
        <Row label={t('card.start')}>{formatDate(term.start)}</Row>
        <Row label={t('card.maturity')}>
          {term.maturity ? formatDate(term.maturity) : t('period.none')}
          {!!back && <span className="ml-1 text-fg-3">{`→ ${back}`}</span>}
        </Row>
        {term.scheduled ? (
          <>
            <Row label={t('card.grossInterest')}>{eur(term.gross)}</Row>
            <Row label={t('card.taxWithheld')} tone="neg">
              {`−${eur(term.withheld)}`}
            </Row>
            <Row label={t('card.netInterest')} tone="pos">
              {eur(term.net)}
            </Row>
            {term.next ? (
              <>
                <Row label={t('card.nextPayment')}>
                  {formatDate(term.next.date)}
                  {' · '}
                  <b className="text-pos">{`+${eur(term.next.net)}`}</b>
                </Row>
                <Row label={t('card.accrued')}>{eur(term.accrued)}</Row>
              </>
            ) : (
              term.matured && <Row label={t('card.status')}>{t('card.matured')}</Row>
            )}
          </>
        ) : (
          <>
            <Row label={t('card.grossToDate')}>{eur(term.gross)}</Row>
            <Row label={t('card.netToDate')} tone="pos">
              {eur(term.net)}
            </Row>
            <Row label={t('card.annualEstimate')}>{eur(term.annualEstimate)}</Row>
          </>
        )}
      </Kv>
      {term.progress !== null && (
        <>
          <ProgressBar value={term.progress} label={t('card.progress')} color="var(--c-yellow)" />
          <span className="text-sm text-fg-3">{t('card.elapsed', { percent: term.progress })}</span>
        </>
      )}
      {term.scheduled && (
        <div className="flex flex-col gap-1">
          <Eyebrow>{t('card.payments')}</Eyebrow>
          {term.payments.length === 0 && (
            <span className="text-sm text-fg-3">{t('card.noPayments')}</span>
          )}
          {term.payments.map((payment) => (
            <div
              key={`${payment.date}-${payment.status}`}
              className="flex min-h-[26px] items-center gap-2 text-sm"
            >
              <span className="tabular-nums text-fg-3">{formatDate(payment.date)}</span>
              <Chip tone={payment.status === 'paid' ? 'pos' : 'default'} className="h-[18px]">
                {payment.status === 'paid' ? t('card.paid') : t('card.planned')}
              </Chip>
              <span className="text-fg-3">
                {t('card.paymentDetail', { days: payment.days, gross: eur(payment.gross) })}
              </span>
              <b className={cn('ml-auto tabular-nums', payment.status === 'paid' && 'text-pos')}>
                {`+${eur(payment.net)}`}
              </b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BrokerageBody({ account, data }: { account: AccountCardDto; data: BrokerageDto }) {
  const t = useTranslations('accounts');
  const money = (value: string) => formatMoney(value, account.currency);
  const invested = Object.entries(data.valueBy).filter(([, value]) => Number(value) !== 0);
  const total = formatMoney(data.valueEur);
  const dividends = data.dividends;
  const sign = Number(data.totalPct) >= 0 ? 'pos' : 'neg';
  return (
    <Kv>
      <Row label={t('card.openingBalance')}>
        {formatMoney(account.opening, account.currency)}
        {!!account.openingDate && (
          <span className="ml-1 text-fg-3">{formatDate(account.openingDate)}</span>
        )}
      </Row>
      <Row label={t('card.movements')}>{account.movements}</Row>
      <Row label={t('card.investments')}>
        {invested.length === 0 && formatMoney('0')}
        {invested.map(([currency, value], index) => (
          <span key={currency}>
            {index > 0 && ' · '}
            {formatMoney(value, currency)}
          </span>
        ))}
        {invested.length > 1 && (
          <span className="block text-xs text-fg-3">{t('card.totalIn', { total })}</span>
        )}
      </Row>
      {data.subAccounts
        .filter((sub) => Number(sub.valueEur) !== 0)
        .map((sub) => (
          <Row key={sub.id} indent label={`↳ ${sub.name}`}>
            {formatMoney(sub.valueEur)}
            {sub.totalPct !== null && (
              <span
                className={cn('ml-1 text-xs', Number(sub.totalPct) >= 0 ? 'text-pos' : 'text-neg')}
              >
                {formatPct(sub.totalPct, { signed: true })}
              </span>
            )}
          </Row>
        ))}
      <Row label={t('card.positions')}>
        {data.positions}
        {data.totalPct !== null && (
          <span className={cn('ml-1', sign === 'pos' ? 'text-pos' : 'text-neg')}>
            {`· ${formatPct(data.totalPct, { signed: true })}`}
          </span>
        )}
      </Row>
      {!data.trackCash && (
        <Row label={t('card.cashNotTracked')}>{t('card.cashNotTrackedValue')}</Row>
      )}
      {(Number(data.deposits) !== 0 || Number(data.withdrawals) !== 0) && (
        <Row
          label={
            Number(data.withdrawals) !== 0 ? t('card.depositsWithdrawals') : t('card.depositsOnly')
          }
        >
          {money(data.deposits)}
          {Number(data.withdrawals) !== 0 && ` / ${money(`-${data.withdrawals}`)}`}
        </Row>
      )}
      {Number(data.buys) !== 0 && <Row label={t('card.buys')}>{money(data.buys)}</Row>}
      {Number(data.sells) !== 0 && <Row label={t('card.sells')}>{money(data.sells)}</Row>}
      {!!dividends && (
        <>
          <Row label={t('card.grossDividends')} tone="pos">
            {money(dividends.gross)}
          </Row>
          <Row label={t('card.withholding')} tone={Number(dividends.tax) > 0 ? 'neg' : undefined}>
            {money(`-${dividends.tax}`)}
            {Number(dividends.gross) > 0 && Number(dividends.tax) > 0 && (
              <span className="ml-1 text-fg-3">
                {`(${formatPct((Number(dividends.tax) / Number(dividends.gross)) * 100, { digits: 1 })})`}
              </span>
            )}
          </Row>
          {Number(dividends.refund) > 0 && (
            <Row label={t('card.refunds')} tone="pos">
              {`+${money(dividends.refund)}`}
            </Row>
          )}
          <Row label={t('card.netDividends')} tone="pos">
            {money(dividends.net)}
          </Row>
          <Row label={t('card.net12')}>{money(dividends.net12Months)}</Row>
        </>
      )}
    </Kv>
  );
}

/** One account of "Contas e poupanças": icon, holders, balance and the figures of its type. */
export function AccountCard({
  account,
  holders,
  accountNames,
  products,
  portfolioName,
  canWrite,
  onEdit,
  onDelete,
  onAddInterest,
  onRemoveInterest,
}: AccountCardProps) {
  const t = useTranslations('accounts');
  const meta = TYPE_META[account.type];
  const Icon = meta.icon;
  const owners = holderNames(account.holderIds, holders);
  const isBroker = account.type === 'brokerage';
  const negativeCash =
    isBroker && account.trackCash && Number(account.balance) < -0.005 && account.movements === 0;
  const interest = account.interest;

  return (
    <Card className="gap-3.5" data-testid={`account-${account.id}`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-[18px]"
          style={{ background: tileBackground(meta.color), color: meta.color }}
        >
          <Icon />
        </span>
        <div className="mr-auto min-w-0">
          <h3 className="m-0 break-words text-base font-semibold">{account.name}</h3>
          <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm text-fg-3">
            {[account.institution, owners].filter(Boolean).join(' · ')}
            {!!portfolioName && (
              <Chip tone="accent" className="h-[18px]">
                {portfolioName}
              </Chip>
            )}
            {account.currency !== 'EUR' && <span>{`· ${account.currency}`}</span>}
          </p>
          {!!account.iban && <p className="m-0 font-mono text-xs text-fg-3">{account.iban}</p>}
        </div>
      </div>
      <div className="text-xl font-bold tabular-nums">{balanceText(account)}</div>

      {negativeCash && (
        <p className="m-0 rounded-md border-l-[3px] border-warn bg-inset p-3 text-sm text-fg-2">
          {t('card.negativeCash')}
        </p>
      )}

      {account.term && (
        <TermBody term={account.term} accountNames={accountNames} products={products} />
      )}

      {!account.term && !isBroker && (
        <Kv>
          <Row label={t('card.openingBalance')}>
            {formatMoney(account.opening, account.currency)}
            {!!account.openingDate && (
              <span className="ml-1 text-fg-3">{formatDate(account.openingDate)}</span>
            )}
          </Row>
          <Row label={t('card.movements')}>{account.movements}</Row>
          {!!account.pendingDeposits && (
            <>
              {Number(account.pendingDeposits.amount) !== 0 && (
                <Row label={t('card.pendingDeposits')}>
                  {formatMoney(account.pendingDeposits.amount, account.currency)}
                </Row>
              )}
              {!!account.pendingDeposits.next && (
                <Row label={t('card.nextDeposit')}>
                  {formatDate(account.pendingDeposits.next.date)}
                  {' · '}
                  {formatMoney(account.pendingDeposits.next.amount, account.currency)}
                </Row>
              )}
            </>
          )}
          {!!interest && (
            <>
              {account.type === 'savings' && (
                <Row label={t('card.currentRate')}>
                  {t('card.rateTanb', { rate: formatPct(account.rate ?? '0', { digits: 2 }) })}
                </Row>
              )}
              <Row label={t('card.interest12')} tone="pos">
                {formatMoney(interest.last12Months, account.currency)}
              </Row>
              <Row label={t('card.effectiveRate')}>
                {interest.effectiveRate === null
                  ? '—'
                  : formatPct(interest.effectiveRate, { digits: 2 })}
              </Row>
              <Row label={t('card.interestTotal')}>
                {formatMoney(interest.total, account.currency)}
              </Row>
            </>
          )}
        </Kv>
      )}

      {account.brokerage && <BrokerageBody account={account} data={account.brokerage} />}

      {!account.term && (
        <InterestBlock account={account} canWrite={canWrite} onRemove={onRemoveInterest} />
      )}

      {canWrite && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {account.type === 'savings' && (
            <Button variant="primary" size="sm" onClick={onAddInterest}>
              <Plus aria-hidden />
              {t('card.addInterest')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('card.editAria', { name: account.name })}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
            {t('card.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon
            aria-label={t('card.remove', { name: account.name })}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
    </Card>
  );
}
