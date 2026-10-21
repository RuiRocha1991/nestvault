import { notFound } from 'next/navigation';

import { CategoriesTab } from '@webapp/components/expenses/categories-tab';
import { ExpensesHeader } from '@webapp/components/expenses/expenses-header';
import { MovementsTab } from '@webapp/components/expenses/movements-tab';
import { SummaryTab } from '@webapp/components/expenses/summary-tab';
import {
  filtersToApiQuery,
  isMonth,
  monthOptions,
  parseFilters,
  parseTab,
} from '@webapp/lib/expenses-view';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import {
  getAccounts,
  getCategories,
  getExpensesSummary,
  getExpensesUsage,
  getMovementsPage,
  getMovementTotals,
  getRules,
} from '@webapp/server/expenses';
import { getHolders } from '@webapp/server/holders';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

// Despesas (mockups 10 to 12, mobile-03): `?tab=resumo|movimentos|categorias`; the month and every
// filter live in the URL, so a refresh or a shared link shows the same screen. The page only
// chooses what to show: the services answer 404 to non-members and 403 to missing permissions.
export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const tab = parseTab(first(query.tab));
  const today = todayInLisbon();

  const [permissions, accounts, categories] = await Promise.all([
    getPoolPermissions(poolId),
    getAccounts(poolId),
    getCategories(poolId),
  ]);

  const header = (
    <ExpensesHeader
      poolId={poolId}
      active={tab}
      canWrite={permissions.includes('transactions.write')}
      accounts={accounts.accounts}
      categories={categories.categories}
      today={today}
    />
  );

  if (tab === 'movimentos') {
    const filters = parseFilters(query);
    const apiQuery = filtersToApiQuery(filters).toString();
    const pageQuery = new URLSearchParams(apiQuery);
    pageQuery.set('limit', String(PAGE_SIZE));
    const [page, totals, { holders }] = await Promise.all([
      getMovementsPage(poolId, pageQuery.toString()),
      getMovementTotals(poolId, apiQuery),
      getHolders(poolId),
    ]);
    return (
      <>
        {header}
        <MovementsTab
          poolId={poolId}
          filters={filters}
          months={monthOptions(filters.month || today.slice(0, 7), today)}
          initial={{ transactions: page.transactions, nextCursor: page.nextCursor }}
          initialTotals={totals}
          accounts={accounts.accounts}
          categories={categories.categories}
          holders={holders}
          canWrite={permissions.includes('transactions.write')}
          canNotes={permissions.includes('notes.write')}
          canRules={permissions.includes('categories.write')}
        />
      </>
    );
  }

  if (tab === 'categorias') {
    const [{ rules }, usage] = await Promise.all([getRules(poolId), getExpensesUsage(poolId)]);
    return (
      <>
        {header}
        <CategoriesTab
          poolId={poolId}
          categories={categories.categories}
          rules={rules}
          accounts={accounts.accounts}
          usage={usage}
          canWrite={permissions.includes('categories.write')}
        />
      </>
    );
  }

  const requested = first(query.month);
  const month = isMonth(requested) ? requested : today.slice(0, 7);
  const summary = await getExpensesSummary(poolId, month);
  return (
    <>
      {header}
      <SummaryTab
        poolId={poolId}
        summary={summary}
        categories={categories.categories}
        today={today}
        canWriteCategories={permissions.includes('categories.write')}
      />
    </>
  );
}
