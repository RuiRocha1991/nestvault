import { Card, EmptyState } from '@nestvault/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ImportScreen } from '@webapp/components/imports/import-screen';
import { Topbar } from '@webapp/components/topbar';
import { isPoolSegment } from '@webapp/lib/pool';
import { getAccountsScreen, getPortfolioList } from '@webapp/server/accounts-screen';
import { getCategories } from '@webapp/server/expenses';
import { getImportHistory } from '@webapp/server/imports';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// "Importar extrato" (NES-64): drop a statement, see what was recognised, confirm. Needs
// `imports.run` (owner, admin and member); a viewer sees a no-access message and no data is loaded
// for them. The API checks the permission again on every call.
export default async function ImportPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [t, permissions] = await Promise.all([
    getTranslations('imports'),
    getPoolPermissions(poolId),
  ]);

  if (!permissions.includes('imports.run')) {
    return (
      <>
        <Topbar title={t('title')} />
        <Card>
          <EmptyState title={t('noAccess.title')} description={t('noAccess.text')} />
        </Card>
      </>
    );
  }

  const [screen, { portfolios }, { categories }, history] = await Promise.all([
    getAccountsScreen(poolId),
    getPortfolioList(poolId),
    getCategories(poolId),
    getImportHistory(poolId),
  ]);

  return (
    <>
      <Topbar title={t('title')} />
      <ImportScreen
        poolId={poolId}
        accounts={screen.accounts}
        portfolios={portfolios}
        categories={categories}
        history={history}
      />
    </>
  );
}
