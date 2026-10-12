import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NotFoundError } from '@nestvault/services';
import { NextResponse } from 'next/server';
import { getAbsoluteFSPath } from 'swagger-ui-dist';


import { buildOpenApiDocument } from '@webapp/openapi/document';
import { route } from '@webapp/server/api/route';
import { apiDocsEnabled } from '@webapp/server/api/runtime';

export const dynamic = 'force-dynamic';

const INITIALIZER = `window.ui = SwaggerUIBundle({
  url: '/api/docs/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: false,
});
`;

// Only these files are served: the name is looked up, never joined to a path from the request.
const FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
};

export const GET = route<{ asset: string }>(async (_req, { params }) => {
  if (!(await apiDocsEnabled())) throw new NotFoundError();
  const { asset } = await params;

  if (asset === 'openapi.json') return NextResponse.json(buildOpenApiDocument());
  if (asset === 'swagger-initializer.js') {
    return new NextResponse(INITIALIZER, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
    });
  }
  const type = Object.hasOwn(FILES, asset) ? FILES[asset] : undefined;
  if (!type) throw new NotFoundError();
  const body = await readFile(join(getAbsoluteFSPath(), asset));
  return new NextResponse(body, { headers: { 'Content-Type': type } });
});
