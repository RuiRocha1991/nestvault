import {
  ApplyRulesDto,
  ApplyRulesInput,
  CreateRuleInput,
  CreateTransactionInput,
  ReorderRulesInput,
  RuleDto,
  RuleListDto,
  TransactionDto,
  TransactionPageDto,
  UpdateRuleInput,
  UpdateTransactionInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Transactions and keyword rules (PRD 04). Guards in the service: session, input validation,
// membership (404 for non-members), `transactions.write` (movements, members too) or
// `categories.write` (rules, owner and admin) for writes (403), then `withPool` (RLS). Writes are
// audited (`transaction.*`, `rule.*`, target id; never descriptions or amounts).

const PoolId = z.uuid();
const TransactionId = z.uuid();
const RuleId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/transactions',
  operationId: 'listTransactions',
  summary: 'Movements of the pool',
  description:
    'Any member may list. Filters: `month` (yyyy-mm), `accountId`, `categoryId` (or `none`), `kind`, `q` (text in the description, matched literally: `%`, `_` and quotes are data) and `withNotes`. `sort` is one of `date`, `amount`, `description` (anything else answers 400), `order` `asc` or `desc`. Pagination is by cursor: pass `nextCursor` back as `cursor` (a cursor of another sort answers 400).',
  tags: ['Transactions'],
  request: {
    params: z.object({ poolId: PoolId }),
    query: z.object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
      accountId: z.uuid().optional(),
      categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
      kind: z.enum(['expense', 'income', 'refund', 'transfer', 'invest']).optional(),
      q: z.string().min(1).max(100).optional(),
      withNotes: z.enum(['true', 'false']).optional(),
      sort: z.enum(['date', 'amount', 'description']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      cursor: z.string().max(600).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: { description: 'A page of movements', ...json(TransactionPageDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/transactions',
  operationId: 'createTransaction',
  summary: 'Record a movement',
  description:
    'Needs `transactions.write` (owner, admin and member). `amount` is signed, in the account currency, a decimal string and not zero. Without `categoryId` the pool’s rules choose one; with one it counts as chosen by hand. A movement that mirrors one in another account (same cents, opposite sign, within the transfer window) is paired as an internal transfer. The body is strict: `poolId`, `hash`, `pairId` or any other field answers 400.',
  tags: ['Transactions'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateTransactionInput) },
  },
  responses: {
    201: { description: 'The new movement', ...json(TransactionDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/transactions/{id}',
  operationId: 'updateTransaction',
  summary: 'Set the category or the transfer flag',
  description:
    'Needs `transactions.write`. `categoryId` sets the category by hand (rules never override it); `null` hands it back to the rules. `transfer` fixes the internal-transfer flag (detection then leaves it alone); `false` releases the other side of a pair. At least one field is needed.',
  tags: ['Transactions'],
  request: {
    params: z.object({ poolId: PoolId, id: TransactionId }),
    body: { required: true, ...json(UpdateTransactionInput) },
  },
  responses: {
    200: { description: 'The updated movement', ...json(TransactionDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/transactions/{id}',
  operationId: 'deleteTransaction',
  summary: 'Delete a movement',
  description: 'Needs `transactions.write`. The other side of a transfer is released.',
  tags: ['Transactions'],
  request: { params: z.object({ poolId: PoolId, id: TransactionId }) },
  responses: {
    204: { description: 'Movement deleted' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/rules',
  operationId: 'listRules',
  summary: 'Keyword rules',
  description: 'Any member may list. In the order the rules are tried.',
  tags: ['Rules'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The rules of the pool', ...json(RuleListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/rules',
  operationId: 'createRule',
  summary: 'Add a rule',
  description:
    'Needs `categories.write` (owner, admin). The keyword is matched at the start of a word of the description; the category is global or the pool’s own (another pool’s answers 400); `accountId` optionally restricts the rule to one account. The rule goes after the last.',
  tags: ['Rules'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateRuleInput) },
  },
  responses: {
    201: { description: 'The new rule', ...json(RuleDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/rules/{id}',
  operationId: 'updateRule',
  summary: 'Change a rule',
  description:
    'Needs `categories.write`. Fields left out stay; `accountId: null` applies the rule to every account.',
  tags: ['Rules'],
  request: {
    params: z.object({ poolId: PoolId, id: RuleId }),
    body: { required: true, ...json(UpdateRuleInput) },
  },
  responses: {
    200: { description: 'The updated rule', ...json(RuleDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/rules/{id}',
  operationId: 'deleteRule',
  summary: 'Delete a rule',
  description: 'Needs `categories.write`.',
  tags: ['Rules'],
  request: { params: z.object({ poolId: PoolId, id: RuleId }) },
  responses: {
    204: { description: 'Rule deleted' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/pools/{poolId}/rules/order',
  operationId: 'reorderRules',
  summary: 'Reorder the rules',
  description:
    'Needs `categories.write`. `ids` must be every rule of the pool, once each, in the new order (anything else answers 400).',
  tags: ['Rules'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(ReorderRulesInput) },
  },
  responses: {
    200: { description: 'The rules in their new order', ...json(RuleListDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/rules/apply',
  operationId: 'applyRules',
  summary: 'Apply the rules to the existing movements',
  description:
    'Needs `categories.write`. `confirm: false` only previews (counts and the first 200 changes); `confirm: true` applies them. A category chosen by hand is never overridden.',
  tags: ['Rules'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(ApplyRulesInput) },
  },
  responses: {
    200: { description: 'What the rules change (or changed)', ...json(ApplyRulesDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});
