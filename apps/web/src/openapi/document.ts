import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import './auth';
import './health';
import './holders';
import './invites';
import './me';
import './members';
import './pools';
import './settings';
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
      { name: 'Pools', description: 'Households of the signed-in user' },
      { name: 'Invites', description: 'Invite people to a pool by email and accept invites' },
      {
        name: 'Members',
        description: 'Roles, removal, leaving and ownership transfer of a pool’s members',
      },
      { name: 'Holders', description: 'The people of the household who own accounts' },
      { name: 'Settings', description: 'Pool settings and the FX rates the pool uses' },
      { name: 'Auth', description: 'Sign-up, sign-in, sessions and passwords (Better Auth)' },
    ],
  });
}
