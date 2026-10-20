import { Card, CardHeader, Table, Td, Th, formatDate, formatMoney } from '@nestvault/ui';
import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Topbar } from '@webapp/components/topbar';
import { isPoolSegment } from '@webapp/lib/pool';
import { matchAssets, parseSearchQuery, SEARCH_TRANSACTIONS } from '@webapp/lib/search-view';
import { getAccountsService, getAssetsService, getTransactionsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

async function search(poolId: string, query: string) {
  const requestHeaders = await headers();
  try {
    const [assets, movements, accounts] = await Promise.all([
      getAssetsService().then((service) => service.list(requestHeaders, poolId)),
      getTransactionsService().then((service) =>
        service.list(requestHeaders, poolId, { q: query, limit: SEARCH_TRANSACTIONS }),
      ),
      getAccountsService().then((service) => service.list(requestHeaders, poolId)),
    ]);
    return {
      assets: matchAssets(assets.assets, query),
      transactions: movements.transactions,
      currency: new Map(accounts.accounts.map((account) => [account.id, account.currency])),
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

// Results of the overview's search box: assets by ticker, symbol or name, and movements by
// description. Both reads go through the services (404 for non-members, `pool.read`); the text is
// matched literally and rendered escaped.
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const query = parseSearchQuery((await searchParams).q);
  const t = await getTranslations('search');

  if (query === null) {
    return (
      <>
        <Topbar title={t('title')} />
        <Card>
          <p className="py-6 text-center text-fg-3">{t('noQuery')}</p>
        </Card>
      </>
    );
  }

  const found = await search(poolId, query);

  return (
    <>
      <Topbar title={t('title')} />
      <p className="mb-4 text-fg-2">{t('resultsFor', { query })}</p>
      <div className="grid gap-4">
        <Card>
          <CardHeader title={t('assets')} headingLevel={3} />
          {found.assets.length === 0 ? (
            <p className="text-sm text-fg-3">{t('noAssets')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {found.assets.map((asset) => (
                <li key={asset.id}>
                  <Link href={`/${poolId}/portfolios`} className="text-fg no-underline">
                    <b>{asset.ticker}</b> <span className="text-fg-2">{asset.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t('transactions')} headingLevel={3} />
          {found.transactions.length === 0 ? (
            <p className="text-sm text-fg-3">{t('noTransactions')}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('date')}</Th>
                  <Th>{t('description')}</Th>
                  <Th numeric>{t('amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {found.transactions.map((movement) => (
                  <tr key={movement.id}>
                    <Td>{formatDate(movement.date)}</Td>
                    <Td>{movement.description}</Td>
                    <Td numeric>
                      {formatMoney(movement.amount, found.currency.get(movement.accountId) ?? 'EUR')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
