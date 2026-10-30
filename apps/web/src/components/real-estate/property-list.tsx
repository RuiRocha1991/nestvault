import { dec, sum, toPlain } from '@nestvault/domain/browser';
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ProgressBar,
  Table,
  Td,
  Th,
  formatDate,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { KeyRow, Stat } from '@webapp/components/real-estate/parts';
import { camelKey, loanFacts, monthYearOf, propertyFigures } from '@webapp/lib/real-estate-view';
import type { RealEstateData } from '@webapp/server/real-estate';

/** Mockup 27: the summary, one card per property, the loans and what comes next. */
export async function PropertyList({ poolId, data }: { poolId: string; data: RealEstateData }) {
  const t = await getTranslations('realEstate.list');
  const tType = await getTranslations('realEstate.propertyType');
  const tIndex = await getTranslations('realEstate.rateIndex');
  const { properties, bundles, works, holders } = data;

  if (properties.length === 0 && bundles.length === 0) {
    return (
      <Card>
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
      </Card>
    );
  }

  const figures = properties.map((property) => ({
    property,
    own: bundles.filter(({ loan }) => loan.propertyId === property.id),
  }));
  const withFigures = figures.map(({ property, own }) => ({
    property,
    own,
    figures: propertyFigures(property, own, works),
  }));
  const value = sum(withFigures.map((p) => p.figures.value ?? 0));
  const debt = sum(bundles.map(({ loan }) => loan.outstanding));
  const payments = sum(bundles.map((bundle) => loanFacts(bundle).payment));
  const worksPaid = sum(works.byProperty.map((row) => row.paid));
  const first = bundles[0];
  const firstFacts = first ? loanFacts(first) : null;
  const holderName = (id: string) => holders.find((holder) => holder.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('summaryTitle')} subtitle={t('summaryText')} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label={t('value')}>{formatMoney(toPlain(value))}</Stat>
          <Stat label={t('debt')} tone="neg">
            {formatMoney(toPlain(debt))}
          </Stat>
          <Stat label={t('equity')} tone="pos">
            {formatMoney(toPlain(value.minus(debt)))}
          </Stat>
          <Stat label={t('payments')}>{formatMoney(toPlain(payments))}</Stat>
          <Stat label={t('worksPaid')}>{formatMoney(toPlain(worksPaid))}</Stat>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          {withFigures.map(({ property, figures: f }) => (
            <Card key={property.id} aria-label={property.name}>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">{property.name}</h2>
                <p className="text-sm text-fg-3">
                  {property.holders
                    .map((h) => `${holderName(h.holderId)} ${formatPct(h.sharePct, { digits: 0 })}`)
                    .join(' · ')}
                </p>
                <Chip tone="accent" className="mt-1 self-start">
                  {tType(camelKey(property.type))}
                </Chip>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
                  {t('equity')}
                </span>
                <b className="text-[26px] font-extrabold tabular-nums">
                  {f.equity === null ? t('noValuation') : formatMoney(f.equity)}
                </b>
              </div>
              <dl className="flex flex-col gap-1.5">
                <KeyRow label={t('value')}>
                  {f.value === null ? '—' : formatMoney(f.value)}
                  {!!f.valueDate && (
                    <span className="ml-1 text-xs text-fg-3">{monthYearOf(f.valueDate)}</span>
                  )}
                </KeyRow>
                <KeyRow label={t('debt')} tone="neg">
                  {formatMoney(f.outstanding)}
                </KeyRow>
                <KeyRow label={t('totalInvested')}>{formatMoney(f.spent.totalInvested)}</KeyRow>
                <KeyRow label={t('works')}>
                  {formatMoney(f.spent.slices.find((s) => s.key === 'works')?.amount ?? '0')}
                </KeyRow>
              </dl>
              <ProgressBar value={Number(f.repaidPct)} label={t('repaid', { pct: f.repaidPct })} />
              <p className="text-xs text-fg-3">{t('repaid', { pct: formatPct(f.repaidPct) })}</p>
              <Link
                href={`/${poolId}/imobiliario/${property.id}`}
                className="inline-flex h-[34px] items-center justify-center self-start rounded-sm border border-accent bg-accent px-3.5 text-md font-semibold text-on-accent hover:border-accent-2 hover:bg-accent-2"
              >
                {t('open')}
              </Link>
            </Card>
          ))}
          <Card>
            <CardHeader title={t('netWorthTitle')} />
            <dl className="flex flex-col gap-2">
              <KeyRow label={t('properties')} tone="pos">
                {formatMoney(toPlain(value))}
              </KeyRow>
              <KeyRow label={t('loans')} tone="neg">
                {formatMoney(toPlain(dec(debt).negated()))}
              </KeyRow>
              <KeyRow label={t('netEffect')} strong>
                {formatMoney(toPlain(value.minus(debt)))}
              </KeyRow>
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('loansTitle')} />
            {bundles.length === 0 ? (
              <EmptyState title={t('noLoans')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('loan')}</Th>
                    <Th numeric>{t('principal')}</Th>
                    <Th numeric>{t('outstanding')}</Th>
                    <Th numeric>{t('nextPayment')}</Th>
                    <Th numeric>{t('rate')}</Th>
                    <Th numeric>{t('end')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((bundle) => {
                    const facts = loanFacts(bundle);
                    const { loan } = bundle;
                    return (
                      <tr key={loan.id}>
                        <Td>
                          <b>{loan.name}</b>
                          {!!loan.rateIndex && (
                            <div className="text-xs text-fg-3">
                              {tIndex(camelKey(loan.rateIndex))}
                              {!!loan.spread && ` + ${formatPct(loan.spread, { digits: 2 })}`}
                            </div>
                          )}
                        </Td>
                        <Td numeric>{formatMoney(loan.principal)}</Td>
                        <Td numeric>{formatMoney(loan.outstanding)}</Td>
                        <Td numeric>
                          {formatMoney(facts.payment)}
                          {!!facts.nextDueDate && (
                            <div className="text-xs text-fg-3">{formatDate(facts.nextDueDate)}</div>
                          )}
                        </Td>
                        <Td numeric>{formatPct(loan.annualRate, { digits: 2 })}</Td>
                        <Td numeric>
                          {facts.endDate ? monthYearOf(facts.endDate) : '—'}
                          <div className="text-xs text-fg-3">
                            {t('installmentsLeft', { count: loan.remainingInstallments })}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {!!first && !!firstFacts && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader title={t('nextTitle')} />
                <dl className="flex flex-col gap-2">
                  {firstFacts.upcoming[0] && (
                    <KeyRow
                      label={t('installmentNumber', { number: firstFacts.upcoming[0].number })}
                    >
                      {formatMoney(firstFacts.upcoming[0].total)}
                      <div className="text-xs text-fg-3">
                        {formatDate(firstFacts.upcoming[0].dueDate)}
                      </div>
                    </KeyRow>
                  )}
                  {!!first.review?.nextReviewDate && (
                    <KeyRow label={t('rateReview')}>
                      {monthYearOf(first.review.nextReviewDate)}
                    </KeyRow>
                  )}
                </dl>
              </Card>
              <Card>
                <CardHeader title={t('rateTitle')} />
                <dl className="flex flex-col gap-2">
                  {!!first.loan.rateIndex && (
                    <KeyRow label={t('index')}>
                      {tIndex(camelKey(first.loan.rateIndex))}
                      {!!first.review?.indexValue &&
                        ` ${formatPct(first.review.indexValue, { digits: 2 })}`}
                    </KeyRow>
                  )}
                  {!!first.loan.spread && (
                    <KeyRow label={t('spread')}>
                      {formatPct(first.loan.spread, { digits: 2 })}
                    </KeyRow>
                  )}
                  <KeyRow label={t('currentRate')} strong>
                    {formatPct(first.loan.annualRate, { digits: 2 })}
                  </KeyRow>
                </dl>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
