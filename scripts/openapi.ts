// Writes docs/api/openapi.json from the zod schemas. `--check` fails when the file is out of date
// (CI), instead of writing it.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOpenApiDocument } from '../apps/web/src/openapi/document';

const target = resolve(import.meta.dirname, '../docs/api/openapi.json');
const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // missing file counts as out of date
  }
  if (current !== generated) {
    console.error('docs/api/openapi.json is out of date. Run: pnpm openapi');
    process.exit(1);
  }
  console.log('docs/api/openapi.json is up to date.');
} else {
  writeFileSync(target, generated);
  console.log('Wrote docs/api/openapi.json');
}
