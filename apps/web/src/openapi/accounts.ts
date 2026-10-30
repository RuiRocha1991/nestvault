import {
  AccountDto,
  AccountListDto,
  AccountsScreenDto,
  CreateAccountInput,
  SubAccountDto,
  SubAccountInput,
  UpdateAccountInput,
  UpdateSubAccountInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Accounts (PRD 04): checking, savings, term-deposit and brokerage accounts with their holders and,
// for brokerage ones, sub-accounts. Guards in the service: session, input validation, membership
// (404 for non-members), `accounts.write` (403) for writes, then `withPool` (RLS). Writes are
// audited (`account.*`, target id only: names, IBANs and balances never reach the log).

const PoolId = z.uuid();
const AccountId = z.uuid();
const SubAccountId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/accounts',
  operationId: 'listAccounts',
  summary: 'Accounts of the pool',
  description:
    'Any member may list. `balance` is a decimal string in the account currency today, `balanceEur` the same value in EUR with the rates the pool uses (override, market, seed).',
  tags: ['Accounts'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The accounts of the pool', ...json(AccountListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/accounts',
  operationId: 'createAccount',
  summary: 'Create an account',
  description:
    'Needs `accounts.write`. `holderIds` (at least one) must be people of this pool. The IBAN is normalized (no spaces, upper case), checked with mod-97 and unique inside the pool (409); the same IBAN in another pool is fine. A term deposit is in EUR. `subAccounts` is only for a brokerage account and each holder must own the account. A Free pool (with `BILLING_ENABLED=true`) is limited to 3 accounts: the next one answers 403 `plan_limit`. The body is strict: `poolId`, `id` or any other field answers 400.',
  tags: ['Accounts'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateAccountInput) },
  },
  responses: {
    201: { description: 'The new account', ...json(AccountDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/accounts/overview',
  operationId: 'accountsOverview',
  summary: 'Cards of the accounts screen',
  description:
    'Any member may read. Every account with its balance (account currency and EUR) plus, by type: interest received and effective rate, the term-deposit schedule (next payment, maturity, progress), brokerage figures (positions, sub-accounts, gross dividends, taxes, refunds, net) and EUR totals per type.',
  tags: ['Accounts'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The accounts screen', ...json(AccountsScreenDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/accounts/{id}',
  operationId: 'getAccount',
  summary: 'One account',
  description: 'Any member may read. An account of another pool answers 404.',
  tags: ['Accounts'],
  request: { params: z.object({ poolId: PoolId, id: AccountId }) },
  responses: {
    200: { description: 'The account', ...json(AccountDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/accounts/{id}',
  operationId: 'updateAccount',
  summary: 'Change an account',
  description:
    'Needs `accounts.write`. Fields left out stay; `holderIds` replaces the owners. 409 for a duplicate IBAN, for leaving a sub-account without its person and for turning an account with sub-accounts into another type.',
  tags: ['Accounts'],
  request: {
    params: z.object({ poolId: PoolId, id: AccountId }),
    body: { required: true, ...json(UpdateAccountInput) },
  },
  responses: {
    200: { description: 'The updated account', ...json(AccountDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/accounts/{id}',
  operationId: 'deleteAccount',
  summary: 'Delete an account',
  description:
    'Needs `accounts.write`. Its holder links and sub-accounts go with it. Answers 409 while the account has movements.',
  tags: ['Accounts'],
  request: { params: z.object({ poolId: PoolId, id: AccountId }) },
  responses: {
    204: { description: 'Account deleted' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/accounts/{id}/sub-accounts',
  operationId: 'createSubAccount',
  summary: 'Add a sub-account',
  description:
    'Needs `accounts.write`. Only a brokerage account has sub-accounts (400 otherwise). `holderId` is optional and must be an owner of the account. Names are unique inside the account (409).',
  tags: ['Accounts'],
  request: {
    params: z.object({ poolId: PoolId, id: AccountId }),
    body: { required: true, ...json(SubAccountInput) },
  },
  responses: {
    201: { description: 'The new sub-account', ...json(SubAccountDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/accounts/{id}/sub-accounts/{subId}',
  operationId: 'updateSubAccount',
  summary: 'Change a sub-account',
  description: 'Needs `accounts.write`. Fields left out stay; `holderId: null` clears the person.',
  tags: ['Accounts'],
  request: {
    params: z.object({ poolId: PoolId, id: AccountId, subId: SubAccountId }),
    body: { required: true, ...json(UpdateSubAccountInput) },
  },
  responses: {
    200: { description: 'The updated sub-account', ...json(SubAccountDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/accounts/{id}/sub-accounts/{subId}',
  operationId: 'deleteSubAccount',
  summary: 'Remove a sub-account',
  description: 'Needs `accounts.write`. Answers 409 while the sub-account has operations.',
  tags: ['Accounts'],
  request: { params: z.object({ poolId: PoolId, id: AccountId, subId: SubAccountId }) },
  responses: {
    204: { description: 'Sub-account removed' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});
