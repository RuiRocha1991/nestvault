import { PortfoliosPage } from '@webapp/components/portfolios/portfolios-page';

export const dynamic = 'force-dynamic';

// One portfolio (NES-50); a portfolio of another pool, or an unknown id, is a 404.
export default async function OnePortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string; portfolioId: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    group?: string | string[];
    moeda?: string | string[];
  }>;
}) {
  const { poolId, portfolioId } = await params;
  return (
    <PortfoliosPage poolId={poolId} portfolioId={portfolioId} searchParams={await searchParams} />
  );
}
