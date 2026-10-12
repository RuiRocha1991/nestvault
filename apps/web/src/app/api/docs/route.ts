import { NotFoundError } from '@nestvault/services';
import { NextResponse } from 'next/server';


import { route } from '@webapp/server/api/route';
import { apiDocsEnabled } from '@webapp/server/api/runtime';

export const dynamic = 'force-dynamic';

// Swagger UI, development only. Scripts are external files served from /api/docs/*: no inline script.
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>NestVault API</title>
    <link rel="stylesheet" href="/api/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/docs/swagger-ui-bundle.js"></script>
    <script src="/api/docs/swagger-initializer.js"></script>
  </body>
</html>
`;

export const GET = route(async () => {
  if (!(await apiDocsEnabled())) throw new NotFoundError();
  return new NextResponse(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
