'use client';

import {
  breakEvenPrice,
  compoundInflation,
  dec,
  euriborSensitivity,
  paceToGoal,
  parseNum,
  realAppreciation,
  saleAnalysis,
  simulatePayoff,
  toPlain,
  type PrepaymentEffect,
  type SimulatorResult,
} from '@nestvault/domain/browser';
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Input,
  Select,
  Table,
  Td,
  Th,
  formatMoney,
  formatPct,
} from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { KeyRow } from '@webapp/components/real-estate/parts';
import {
  DEFAULT_CPI,
  loanFacts,
  monthYearOf,
  ratesSince,
  type PropertyView,
  type PropertyFigures,
} from '@webapp/lib/real-estate-view';
import type { LoanBundle } from '@webapp/server/real-estate';

const DASH = '—';
const SCENARIOS = [0.8, 0.9, 1, 1.1] as const;
const SENSITIVITY_STEPS = [0, 1, 2] as const;
const DEFAULT_SELLING_PCT = '5';
const DEFAULT_GOAL_YEARS = '20';

const signed = (value: string) => (value.startsWith('-') ? value : `+${value}`);
const tone = (value: string) => (value.startsWith('-') ? 'text-neg' : 'text-pos');

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {!!hint && <span className="text-xs font-normal text-fg-3">{hint}</span>}
    </label>
  );
}

/**
 * Mockup 32: the sale analysis, the payoff simulator (nothing is saved), the pace to a goal and the
 * inflation card. All calculations are the domain's (`property-analysis.ts`); this only reads the
 * inputs. A number that is not valid makes its card show a hint instead of a result.
 */
export function SaleSimulatorTab({
  property,
  figures,
  bundle,
}: {
  property: PropertyView;
  figures: PropertyFigures;
  bundle: LoanBundle | undefined;
}) {
  const t = useTranslations('realEstate.sale');
  const tSim = useTranslations('realEstate.simulator');
  const tPace = useTranslations('realEstate.pace');
  const tCpi = useTranslations('realEstate.inflation');
  const facts = bundle ? loanFacts(bundle) : null;
  const loan = bundle?.loan;

  // --- sale analysis
  const [price, setPrice] = useState(figures.value ?? property.purchasePrice);
  const [sellingPct, setSellingPct] = useState(property.sellingCostPct ?? DEFAULT_SELLING_PCT);
  const priceNum = parseNum(price);
  const pctNum = parseNum(sellingPct);
  const sale =
    priceNum !== null && pctNum !== null && dec(pctNum).lte(100)
      ? {
          price: priceNum,
          result: saleAnalysis({
            price: priceNum,
            debt: figures.outstanding,
            sellingCostPct: pctNum,
            totalSpent: figures.spent.totalSpent,
          }),
          breakEven: breakEvenPrice({
            debt: figures.outstanding,
            sellingCostPct: pctNum,
            totalSpent: figures.spent.totalSpent,
          }),
          pct: pctNum,
        }
      : null;

  // --- simulator
  const spread = loan?.spread ?? (loan?.rateIndex ? '0' : (loan?.annualRate ?? '0'));
  const defaultEuribor =
    bundle?.review?.indexValue ??
    (loan?.rateIndex ? toPlain(dec(loan.annualRate).minus(spread)) : '0');
  const [euribor, setEuribor] = useState(defaultEuribor);
  const [prepay, setPrepay] = useState('0');
  const [prepayDate, setPrepayDate] = useState(facts?.nextDueDate ?? '');
  const [effect, setEffect] = useState<PrepaymentEffect>('reduce_term');
  const [finish, setFinish] = useState('');
  const [goalYears, setGoalYears] = useState(DEFAULT_GOAL_YEARS);

  const simulation = useMemo<SimulatorResult | null>(() => {
    if (!loan || !facts?.nextDueDate) return null;
    const index = parseNum(euribor);
    const amount = parseNum(prepay);
    const years = finish.trim() === '' ? null : Number(finish.replace(',', '.'));
    if (index === null || amount === null || (years !== null && !(years > 0))) return null;
    try {
      return simulatePayoff({
        balance: loan.outstanding,
        currentRatePct: loan.annualRate,
        remainingMonths: loan.remainingInstallments,
        nextDueDate: facts.nextDueDate,
        spreadPct: spread,
        euriborPct: index,
        prepayment: dec(amount).gt(0)
          ? { amount, date: prepayDate || facts.nextDueDate, effect }
          : undefined,
        finishInYears: years,
      });
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  }, [loan, facts, euribor, prepay, prepayDate, effect, finish, spread]);

  const sensitivity = useMemo(() => {
    const index = parseNum(euribor);
    if (!loan || index === null || loan.remainingInstallments < 1) return [];
    return euriborSensitivity(
      {
        balance: loan.outstanding,
        currentRatePct: loan.annualRate,
        remainingMonths: loan.remainingInstallments,
        spreadPct: spread,
        euriborPct: index,
      },
      SENSITIVITY_STEPS,
    );
  }, [loan, euribor, spread]);

  // --- pace
  const years = Number(goalYears.replace(',', '.'));
  const pace =
    loan && facts && years > 0
      ? paceToGoal(loan.principal, facts.capitalPaid, facts.paidCount, years)
      : null;

  // --- inflation (the series is editable here and not saved)
  const [cpi, setCpi] = useState(() => ratesSince(DEFAULT_CPI, property.purchaseDate));
  const [editing, setEditing] = useState(false);
  const inflation = compoundInflation(
    cpi.map((row) => ({ year: row.year, ratePct: parseNum(row.ratePct) ?? '0' })),
  );
  const real = figures.value
    ? realAppreciation(property.purchasePrice, figures.value, inflation.factor)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('title')} subtitle={t('text')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('price')}>
              <Input
                inputMode="decimal"
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                }}
                className="text-right"
              />
            </Field>
            <Field label={t('sellingCosts')}>
              <Input
                inputMode="decimal"
                value={sellingPct}
                onChange={(event) => {
                  setSellingPct(event.target.value);
                }}
                className="text-right"
              />
            </Field>
          </div>
          {sale ? (
            <>
              <dl className="flex flex-col gap-1.5">
                <KeyRow label={t('salePrice')}>{formatMoney(sale.price)}</KeyRow>
                <KeyRow label={t('minusDebt')}>{formatMoney(figures.outstanding)}</KeyRow>
                <KeyRow label={t('minusCosts', { pct: formatPct(sale.pct) })}>
                  {formatMoney(sale.result.sellingCosts)}
                </KeyRow>
                <KeyRow label={t('net')} strong>
                  {formatMoney(sale.result.netProceeds)}
                </KeyRow>
                <KeyRow label={t('minusSpent')}>{formatMoney(figures.spent.totalSpent)}</KeyRow>
                <KeyRow
                  label={t('gain')}
                  strong
                  tone={sale.result.gain.startsWith('-') ? 'neg' : 'pos'}
                >
                  {signed(formatMoney(sale.result.gain))}
                </KeyRow>
              </dl>
              {sale.breakEven !== null && (
                <p className="rounded-sm bg-inset p-3 text-sm text-fg-2">
                  {t('breakEven', {
                    price: formatMoney(sale.breakEven),
                    equity: figures.equity === null ? '—' : formatMoney(figures.equity),
                  })}
                </p>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>{t('scenarioPrice')}</Th>
                    <Th numeric>{t('scenarioNet')}</Th>
                    <Th numeric>{t('scenarioGain')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {SCENARIOS.map((factor) => {
                    const scenarioPrice = toPlain(dec(sale.price).times(factor).toDecimalPlaces(0));
                    const result = saleAnalysis({
                      price: scenarioPrice,
                      debt: figures.outstanding,
                      sellingCostPct: sale.pct,
                      totalSpent: figures.spent.totalSpent,
                    });
                    return (
                      <tr key={factor}>
                        <Td>{formatMoney(scenarioPrice)}</Td>
                        <Td numeric>{formatMoney(result.netProceeds)}</Td>
                        <Td numeric className={tone(result.gain)}>
                          {signed(formatMoney(result.gain))}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </>
          ) : (
            <p className="text-sm text-neg" role="alert">
              {t('invalid')}
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title={tSim('title')} subtitle={tSim('text')} />
          {loan && facts?.nextDueDate ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={tSim('euribor')}
                  hint={tSim('rateHint', {
                    spread: formatPct(spread, { digits: 2 }),
                    rate: simulation ? formatPct(simulation.rate, { digits: 2 }) : '—',
                  })}
                >
                  <Input
                    inputMode="decimal"
                    value={euribor}
                    onChange={(event) => {
                      setEuribor(event.target.value);
                    }}
                    className="text-right"
                  />
                </Field>
                <Field label={tSim('prepayment')}>
                  <Input
                    inputMode="decimal"
                    value={prepay}
                    onChange={(event) => {
                      setPrepay(event.target.value);
                    }}
                    className="text-right"
                  />
                </Field>
                <Field label={tSim('prepaymentDate')}>
                  <Input
                    type="date"
                    value={prepayDate}
                    onChange={(event) => {
                      setPrepayDate(event.target.value);
                    }}
                  />
                </Field>
                <Field label={tSim('effect')}>
                  <Select
                    value={effect}
                    onChange={(event) => {
                      setEffect(event.target.value as PrepaymentEffect);
                    }}
                  >
                    <option value="reduce_term">{tSim('reduceTerm')}</option>
                    <option value="reduce_installment">{tSim('reduceInstallment')}</option>
                  </Select>
                </Field>
                <Field
                  label={tSim('finishIn')}
                  hint={
                    simulation?.simulated.endDate
                      ? tSim('endsIn', { date: monthYearOf(simulation.simulated.endDate) })
                      : undefined
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={finish}
                    placeholder={tSim('finishPlaceholder')}
                    onChange={(event) => {
                      setFinish(event.target.value);
                    }}
                    className="text-right"
                  />
                </Field>
              </div>
              {simulation ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>{tSim('result')}</Th>
                      <Th numeric>{tSim('current')}</Th>
                      <Th numeric className="bg-accent-soft">
                        {tSim('simulated')}
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <Td>{tSim('installment')}</Td>
                      <Td numeric>{formatMoney(simulation.current.payment)}</Td>
                      <Td numeric className="bg-accent-soft">
                        {formatMoney(simulation.simulated.payment)}
                      </Td>
                    </tr>
                    <tr>
                      <Td>{tSim('end')}</Td>
                      <Td numeric>
                        {simulation.current.endDate ? monthYearOf(simulation.current.endDate) : '—'}
                      </Td>
                      <Td numeric className="bg-accent-soft">
                        {simulation.simulated.endDate
                          ? monthYearOf(simulation.simulated.endDate)
                          : '—'}
                      </Td>
                    </tr>
                    <tr>
                      <Td>{tSim('interestLeft')}</Td>
                      <Td numeric>{formatMoney(simulation.current.interestToPay)}</Td>
                      <Td numeric className="bg-accent-soft">
                        {formatMoney(simulation.simulated.interestToPay)}
                      </Td>
                    </tr>
                    <tr>
                      <Td className="font-bold">{tSim('extraPerMonth')}</Td>
                      <Td numeric>{DASH}</Td>
                      <Td
                        numeric
                        className={`bg-accent-soft font-bold ${Number(simulation.extraPerMonth) > 0 ? 'text-neg' : 'text-pos'}`}
                      >
                        {signed(formatMoney(simulation.extraPerMonth))}
                      </Td>
                    </tr>
                    <tr>
                      <Td className="font-bold">{tSim('interestSaved')}</Td>
                      <Td numeric>{DASH}</Td>
                      <Td
                        numeric
                        className={`bg-accent-soft font-bold ${tone(simulation.interestSaved)}`}
                      >
                        {signed(formatMoney(simulation.interestSaved))}
                      </Td>
                    </tr>
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-neg" role="alert">
                  {tSim('invalid')}
                </p>
              )}
              {sensitivity.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">
                    {tSim('sensitivityTitle')}
                  </h3>
                  <Table>
                    <thead>
                      <tr>
                        <Th>{tSim('euribor')}</Th>
                        <Th numeric>{tSim('rate')}</Th>
                        <Th numeric>{tSim('installment')}</Th>
                        <Th numeric>{tSim('difference')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivity.map((row) => (
                        <tr key={row.euriborPct}>
                          <Td>{formatPct(row.euriborPct, { digits: 2 })}</Td>
                          <Td numeric>{formatPct(row.ratePct, { digits: 2 })}</Td>
                          <Td numeric>{formatMoney(row.payment)}</Td>
                          <Td
                            numeric
                            className={Number(row.difference) > 0 ? 'text-neg' : undefined}
                          >
                            {Number(row.difference) === 0
                              ? '—'
                              : signed(formatMoney(row.difference))}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-3">{tSim('noLoan')}</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={tPace('title', { years: goalYears })} />
          {pace && facts && loan ? (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KeyStat label={tPace('goalPerMonth')} value={formatMoney(pace.goalPerMonth)} />
                <KeyStat label={tPace('paidPerMonth')} value={formatMoney(pace.paidPerMonth)} />
                <KeyStat label={tPace('idealPaid')} value={formatMoney(pace.idealPaid)} />
                <KeyStat
                  label={tPace('difference')}
                  value={formatMoney(pace.difference)}
                  className={pace.ahead ? 'text-pos' : 'text-neg'}
                />
              </div>
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-3">
                <Chip tone={pace.ahead ? 'pos' : 'warn'}>
                  {tPace(pace.ahead ? 'ahead' : 'behind')}
                </Chip>
                {tPace('count', { paid: facts.paidCount, goal: Math.round(years * 12) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-3">{tPace('noLoan')}</p>
          )}
          <Field label={tPace('goalYears')}>
            <Input
              inputMode="decimal"
              value={goalYears}
              onChange={(event) => {
                setGoalYears(event.target.value);
              }}
              className="w-24 text-right"
            />
          </Field>
        </Card>

        <Card>
          <CardHeader
            title={tCpi('title')}
            subtitle={tCpi('text', { year: property.purchaseDate.slice(0, 4) })}
            actions={
              <Button
                size="sm"
                aria-pressed={editing}
                onClick={() => {
                  setEditing((value) => !value);
                }}
              >
                {tCpi(editing ? 'done' : 'edit')}
              </Button>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>{tCpi('year')}</Th>
                <Th numeric>{tCpi('rate')}</Th>
                <Th numeric>{tCpi('index')}</Th>
              </tr>
            </thead>
            <tbody>
              {inflation.rows.map((row, index) => (
                <tr key={row.year}>
                  <Td>{row.year}</Td>
                  <Td numeric>
                    {editing ? (
                      <Input
                        inputMode="decimal"
                        aria-label={tCpi('rateOf', { year: row.year })}
                        value={cpi[index]?.ratePct ?? ''}
                        onChange={(event) => {
                          setCpi((rows) =>
                            rows.map((item, i) =>
                              i === index ? { ...item, ratePct: event.target.value } : item,
                            ),
                          );
                        }}
                        className="w-20 text-right"
                      />
                    ) : (
                      formatPct(row.ratePct, { digits: 2 })
                    )}
                  </Td>
                  <Td numeric>{formatNumberIndex(row.index)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!!real && (
            <dl className="flex flex-col gap-1.5">
              <KeyRow label={tCpi('purchase', { year: property.purchaseDate.slice(0, 4) })}>
                {formatMoney(property.purchasePrice)}
              </KeyRow>
              <KeyRow label={tCpi('adjusted')} strong>
                {formatMoney(real.adjustedPrice)}
              </KeyRow>
              <KeyRow label={tCpi('nominal')}>{formatPct(real.nominalPct)}</KeyRow>
              <KeyRow label={tCpi('real')} tone={real.realPct.startsWith('-') ? 'neg' : 'pos'}>
                {formatPct(real.realPct)}
              </KeyRow>
            </dl>
          )}
          <p className="rounded-sm bg-inset p-3 text-xs text-fg-2">
            {tCpi('note', {
              compounded: formatPct(inflation.compoundedPct),
              summed: formatPct(inflation.summedPct),
            })}
          </p>
        </Card>
      </div>
    </div>
  );
}

function KeyStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-3">{label}</span>
      <b className={`text-[20px] font-extrabold tabular-nums ${className ?? ''}`}>{value}</b>
    </div>
  );
}

/** `1.0127` → `1,0127`. */
const formatNumberIndex = (value: string): string => value.replace('.', ',');
