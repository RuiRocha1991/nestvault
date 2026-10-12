import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as services from '@nestvault/services';
import { HealthDto } from '@nestvault/services';

import { GET as getHealth } from '../../apps/web/src/app/api/v1/health/route';
import { buildOpenApiDocument } from '../../apps/web/src/openapi/document';
import { VALID_ENV } from '../config/fixtures';

// The handlers log through the shared logger; keep the test output quiet.
vi.mock('@nestvault/services', async (importOriginal) => {
  const original = await importOriginal<typeof services>();
  return { ...original, logger: original.createLogger({ level: 'silent' }) };
});

const url = (path: string) => new Request(`http://localhost:4000${path}`);
const asset = (name: string) => ({ params: Promise.resolve({ asset: name }) });

// The docs gate reads the validated configuration, like the rest of the server.
function stubEnv(overrides: Record<string, string>) {
  // A developer's or CI's own .env.local may already define the flag: start from "unset".
  vi.stubEnv('ENABLE_API_DOCS', undefined);
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('needs no session and answers with the output schema only', async () => {
    const response = await getHealth(url('/api/v1/health'), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(HealthDto.parse(await response.json())).toEqual({ status: 'ok' });
  });
});

describe('OpenAPI document', () => {
  const document = buildOpenApiDocument();

  it('registers the health endpoint with the shared error schema and the session cookie scheme', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths?.['/api/v1/health']?.get?.operationId).toBe('getHealth');
    expect(document.components?.schemas).toHaveProperty('ErrorResponse');
    expect(document.components?.securitySchemes?.sessionCookie).toMatchObject({ in: 'cookie' });
  });

  it('docs/api/openapi.json is up to date (run `pnpm openapi`)', () => {
    const file = readFileSync(resolve(import.meta.dirname, '../../docs/api/openapi.json'), 'utf8');
    expect(file).toBe(`${JSON.stringify(document, null, 2)}\n`);
  });
});

describe('Swagger UI at /api/docs', () => {
  // The gate reads the configuration once per module load, so each case loads fresh modules.
  async function docs(overrides: Record<string, string>) {
    stubEnv(overrides);
    vi.resetModules();
    const page = (await import('../../apps/web/src/app/api/docs/route')).GET;
    const file = (await import('../../apps/web/src/app/api/docs/[asset]/route')).GET;
    return {
      page: () => page(url('/api/docs'), { params: Promise.resolve({}) }),
      file: (name: string) => file(url(`/api/docs/${name}`), asset(name)),
    };
  }
  const open = { NODE_ENV: 'development', ENABLE_API_DOCS: 'true' };

  it('serves the page, the generated document and its own files when enabled outside production', async () => {
    const { page, file } = await docs(open);
    const response = await page();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('/api/docs/swagger-ui-bundle.js');
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>\s*\S/); // no inline script

    const json = await file('openapi.json');
    expect(((await json.json()) as { paths: object }).paths).toHaveProperty('/api/v1/health');
    expect((await file('swagger-ui.css')).status).toBe(200);
    expect((await file('swagger-initializer.js')).status).toBe(200);
  });

  it.each([
    ['production, even with the flag on', { NODE_ENV: 'production', ENABLE_API_DOCS: 'true' }],
    ['development with the flag off', { NODE_ENV: 'development', ENABLE_API_DOCS: 'false' }],
    ['development with the flag unset', { NODE_ENV: 'development' }],
  ])('is not served in %s', async (_name, overrides) => {
    const { page, file } = await docs(overrides);
    expect((await page()).status).toBe(404);
    for (const name of ['openapi.json', 'swagger-ui.css', 'swagger-initializer.js']) {
      expect((await file(name)).status, name).toBe(404);
    }
  });

  it('serves only its allow-listed files (no path traversal)', async () => {
    const { file } = await docs(open);
    for (const name of [
      '../../package.json',
      '..%2F..%2Fpackage.json',
      'package.json',
      'constructor',
      '__proto__',
    ]) {
      expect((await file(name)).status, name).toBe(404);
    }
  });
});
