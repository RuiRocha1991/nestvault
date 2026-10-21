import { cn } from '@nestvault/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Topbar } from '@webapp/components/topbar';
import type { AccountView, CategoryView } from '@webapp/lib/expenses-types';
import { EXPENSE_TABS, type ExpenseTab } from '@webapp/lib/expenses-view';

import { NewMovementButton } from './new-movement-button';

const tabStyles = '-mb-px whitespace-nowrap border-b-2 pb-3 text-md font-medium no-underline';

export interface ExpensesHeaderProps {
  poolId: string;
  active: ExpenseTab;
  /** Manual movements need `transactions.write`; the button is cosmetic, the service decides. */
  canWrite: boolean;
  accounts: readonly Pick<AccountView, 'id' | 'name' | 'currency'>[];
  categories: readonly CategoryView[];
  today: string;
}

/** Title, the "+ Movimento" action and the three tabs of the Despesas screen (mockups 10 to 12). */
export async function ExpensesHeader({
  poolId,
  active,
  canWrite,
  accounts,
  categories,
  today,
}: ExpensesHeaderProps) {
  const t = await getTranslations('expenses');
  return (
    <>
      <Topbar title={t('title')} />
      {canWrite && (
        <div className="-mt-2 mb-4 flex flex-wrap justify-end gap-2">
          <NewMovementButton
            poolId={poolId}
            accounts={accounts}
            categories={categories}
            today={today}
          />
        </div>
      )}
      {/* `pb-px` holds the 1px the active tab's underline sticks out, so no scrollbar appears. */}
      <nav aria-label={t('tabsLabel')} className="mb-5 overflow-x-auto border-b border-line pb-px">
        <ul className="m-0 flex list-none gap-5 p-0">
          {EXPENSE_TABS.map((tab) => (
            <li key={tab}>
              <Link
                href={`/${poolId}/despesas?tab=${tab}`}
                aria-current={tab === active ? 'page' : undefined}
                className={cn(
                  tabStyles,
                  'block',
                  tab === active
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-2 hover:text-fg',
                )}
              >
                {t(`tabs.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
