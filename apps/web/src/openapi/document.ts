import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import './auth';
import './health';
import './imports';
import './accounts';
import './transactions';
import './expenses';
import './investments';
import './savings';
import './notes';
import './overview';
import './assets';
import './categories';
import './holders';
import './invites';
import './me';
import './members';
import './pools';
import './prototype-import';
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
      {
        name: 'Accounts',
        description: 'Bank, savings, deposit and brokerage accounts with their holders',
      },
      { name: 'Assets', description: 'Assets (unique ticker per pool) and their price history' },
      {
        name: 'Categories',
        description: 'The global category catalogue and the pool’s own categories',
      },
      { name: 'Transactions', description: 'Bank movements with their categories and transfers' },
      { name: 'Overview', description: 'The overview screen in one read' },
      { name: 'Expenses', description: 'Month summary and totals of the Despesas screen' },
      { name: 'Portfolios', description: 'Portfolios with their summary' },
      { name: 'Operations', description: 'Buys, sells and dividends of the portfolios' },
      { name: 'Plans', description: 'Regular investment plans and their monthly runs' },
      { name: 'Products', description: 'Savings products (rate, period, term, tax)' },
      { name: 'Deposits', description: 'Term deposits with their schedule and maturity' },
      { name: 'Interest', description: 'Interest received by savings accounts, entered by hand' },
      {
        name: 'Imports',
        description: 'Bank and broker statements: upload, preview and idempotent commit',
      },
      { name: 'Notes', description: 'Notes on movements and operations, and month notes' },
      { name: 'Rules', description: 'Keyword rules that categorize movements' },
      { name: 'Holders', description: 'The people of the household who own accounts' },
      { name: 'Settings', description: 'Pool settings and the FX rates the pool uses' },
      { name: 'Auth', description: 'Sign-up, sign-in, sessions and passwords (Better Auth)' },
    ],
  });
}
