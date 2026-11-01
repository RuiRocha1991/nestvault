import { route } from '@webapp/server/api/route';
import { signedIn } from '@webapp/server/api/signed-in';
import { getRealEstateImportsService } from '@webapp/server/auth';

export const dynamic = 'force-dynamic';

// A CSV template to fill in: `loan-installments` or `works-payments`. Guards (in the service):
// session, membership (404), `imports.run` (403), the Pro plan; an unknown name answers 404. A read:
// no audit entry.
export const GET = route<{ poolId: string; name: string }>(async (req, ctx) => {
  await signedIn(req, ctx);
  const { poolId, name } = await ctx.params;
  ctx.setActor({ poolId });
  const file = await (await getRealEstateImportsService()).template(req.headers, poolId, name);
  return new Response(file.text, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
});
