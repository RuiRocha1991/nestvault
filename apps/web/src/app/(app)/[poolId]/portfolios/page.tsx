import { PortfoliosPage } from '@webapp/components/portfolios/portfolios-page';

export const dynamic = 'force-dynamic';

// Portfolios, all together (NES-50). The tab is in the URL (`?tab=`), so a refresh keeps it.
export default async function AllPortfoliosPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ tab?: string | string[]; group?: string | string[] }>;
}) {
  const { poolId } = await params;
  return <PortfoliosPage poolId={poolId} searchParams={await searchParams} />;
}
