import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import './auth';
import './health';
import './me';
import { registry } from './registry';

/** The OpenAPI 3.1 document of every `/api/v1` endpoint. Import new endpoint modules above. */
export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'NestVault API',
      version: '0.1.0',
      description: 'REST API of the NestVault family finance app. Generated from the zod schemas.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    security: [{ sessionCookie: [] }],
    tags: [
      { name: 'System', description: 'Process-level endpoints' },
      { name: 'Account', description: 'Profile and sessions of the signed-in user' },
      { name: 'Auth', description: 'Sign-up, sign-in, sessions and passwords (Better Auth)' },
    ],
  });
}
