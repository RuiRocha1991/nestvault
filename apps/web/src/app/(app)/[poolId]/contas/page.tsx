import { nextHolderColor } from '@nestvault/services';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccountsScreen } from '@webapp/components/accounts/accounts-screen';
import { Topbar } from '@webapp/components/topbar';
import { isPoolSegment } from '@webapp/lib/pool';
import {
  getAccountsScreen,
  getPortfolioList,
  getSavingsProducts,
} from '@webapp/server/accounts-screen';
import { getCategories } from '@webapp/server/expenses';
import { getHolders } from '@webapp/server/holders';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// "Contas e poupanças" (NES-51): every account with its balance, and the savings products. Reading needs `pool.read`; the management buttons need `accounts.write`
// (the services check it again on every call).
export default async function AccountsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [t, permissions, screen, { products }, { portfolios }, { holders }] = await Promise.all([
    getTranslations('nav.items'),
    getPoolPermissions(poolId),
    getAccountsScreen(poolId),
    getSavingsProducts(poolId),
    getPortfolioList(poolId),
    getHolders(poolId),
  ]);
  // The import dialogs show predicted categories; only people who may import need them.
  const canImport = permissions.includes('imports.run');
  const categories = canImport ? (await getCategories(poolId)).categories : [];

  return (
    <>
      <Topbar title={t('accounts')} />
      <AccountsScreen
        poolId={poolId}
        screen={screen}
        products={products}
        portfolios={portfolios}
        holders={holders}
        suggestedColor={nextHolderColor(holders.map((holder) => holder.color))}
        canWrite={permissions.includes('accounts.write')}
        canImport={canImport}
        categories={categories}
      />
    </>
  );
}
