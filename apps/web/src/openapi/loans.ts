import {
  CreateEventInput,
  CreateFieldInput,
  EventDto,
  EventListDto,
  ReviewPreviewDto,
  CreateInstallmentInput,
  CreateLoanInput,
  InstallmentDto,
  InstallmentLinkDto,
  InstallmentListDto,
  LinkInstallmentInput,
  MatchResultDto,
  LoanDto,
  LoanFieldDto,
  LoanListDto,
  ScheduleDto,
  UpdateFieldInput,
  UpdateInstallmentInput,
  UpdateLoanInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Loans (PRD "Real estate and loans", Pro). Guards in the service: session, input validation,
// membership (404 for non-members), `pool.read` for reads or `realestate.write` (owner, admin) for
// writes (403), then the Pro plan (403 `plan_limit`, `error.resource` `real_estate`, reads
// included). Then `withPool` (RLS). Writes are audited (`loan.*`, target id; never amounts).

const PoolId = z.uuid();
const Pool = z.object({ poolId: PoolId });
const Params = Pool.extend({ id: z.uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans',
  operationId: 'listLoans',
  summary: 'Loans of the pool',
  description:
    'Any member of a Pro pool may list. Each loan comes with its fields, what has been paid so far (capital, interest and enabled fields), the outstanding capital and the installments left; all derived from the installments entered.',
  tags: ['Loans'],
  request: { params: Pool },
  responses: {
    200: { description: 'The list', ...json(LoanListDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/loans',
  operationId: 'createLoan',
  summary: 'Create a loan',
  description:
    'Needs `realestate.write` (owner, admin) and the Pro plan. A variable or mixed rate needs `rateIndex`; a mixed one also needs `fixedUntil`. `propertyId` and `debitAccountId` must belong to the pool. The loan is created with the built-in fields (life and home insurance enabled). The body is strict: `poolId` or any other field answers 400.',
  tags: ['Loans'],
  request: { params: Pool, body: { required: true, ...json(CreateLoanInput) } },
  responses: {
    201: { description: 'Created', ...json(LoanDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans/{id}',
  operationId: 'getLoan',
  summary: 'One loan',
  description: 'Any member of a Pro pool may read.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'The item', ...json(LoanDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/loans/{id}',
  operationId: 'updateLoan',
  summary: 'Change a loan',
  description: 'Needs `realestate.write` and the Pro plan. Fields left out stay.',
  tags: ['Loans'],
  request: { params: Params, body: { required: true, ...json(UpdateLoanInput) } },
  responses: {
    200: { description: 'The updated item', ...json(LoanDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/loans/{id}',
  operationId: 'deleteLoan',
  summary: 'Delete a loan',
  description:
    'Needs `realestate.write` and the Pro plan. Its fields and installments are deleted.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans/{id}/schedule',
  operationId: 'getLoanSchedule',
  summary: 'Amortization schedule',
  description:
    'The installments entered (`actual`) followed by the French-amortization projection of the rest (`projected`) from the outstanding capital and the loan rate, plus the totals per contract year (installments 1–12 are year 1).',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'The schedule', ...json(ScheduleDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments',
  operationId: 'listLoanInstallments',
  summary: 'Installments of a loan',
  description:
    'Any member of a Pro pool may read. Oldest first; `total` counts only enabled fields.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'The installments', ...json(InstallmentListDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments',
  operationId: 'addLoanInstallment',
  summary: 'Record an installment',
  description:
    'Needs `realestate.write` and the Pro plan. `number` is 1 to the loan term and unique per loan (409 otherwise). Optional components default to 0; `custom` maps the keys of custom fields to amounts.',
  tags: ['Loans'],
  request: { params: Params, body: { required: true, ...json(CreateInstallmentInput) } },
  responses: {
    201: { description: 'Recorded', ...json(InstallmentDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments/{installmentId}',
  operationId: 'updateLoanInstallment',
  summary: 'Correct an installment',
  description: 'Needs `realestate.write` and the Pro plan. The number cannot change.',
  tags: ['Loans'],
  request: {
    params: Params.extend({ installmentId: z.uuid() }),
    body: { required: true, ...json(UpdateInstallmentInput) },
  },
  responses: {
    200: { description: 'The updated item', ...json(InstallmentDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments/{installmentId}',
  operationId: 'deleteLoanInstallment',
  summary: 'Delete an installment',
  description: 'Needs `realestate.write` and the Pro plan.',
  tags: ['Loans'],
  request: { params: Params.extend({ installmentId: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments/{installmentId}/transaction',
  operationId: 'linkLoanInstallment',
  summary: 'Pay an installment with a bank debit',
  description:
    'Needs `realestate.write` and the Pro plan. The movement must be a debit of the pool that is not a transfer; it pays at most one installment and an installment has at most one debit (409 otherwise). From then on only the interest, fees, taxes and insurances of the installment count as an expense; the capital is savings. The movement itself is never changed.',
  tags: ['Loans'],
  request: {
    params: Params.extend({ installmentId: z.uuid() }),
    body: { required: true, ...json(LinkInstallmentInput) },
  },
  responses: {
    200: { description: 'The link and how the debit counts', ...json(InstallmentLinkDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments/{installmentId}/transaction',
  operationId: 'unlinkLoanInstallment',
  summary: 'Take the link away',
  description:
    'Needs `realestate.write` and the Pro plan. The debit counts as a plain expense again.',
  tags: ['Loans'],
  request: { params: Params.extend({ installmentId: z.uuid() }) },
  responses: {
    204: { description: 'Unlinked' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/loans/{id}/installments/match',
  operationId: 'matchLoanInstallments',
  summary: 'Link the installments to their bank debits',
  description:
    'Needs `realestate.write` and the Pro plan, and a debit account on the loan (400 otherwise). Every unlinked installment is linked to the debit of that account that is not a transfer, equals its total to within 5 cents and falls within 5 days of its due date (the closest date wins, a debit is used once). No body.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'What was linked', ...json(MatchResultDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/loans/{id}/fields',
  operationId: 'addLoanField',
  summary: 'Add a custom installment field',
  description:
    'Needs `realestate.write` and the Pro plan. The key is letters and digits and cannot be a built-in one; a repeated key answers 409. The field starts enabled.',
  tags: ['Loans'],
  request: { params: Params, body: { required: true, ...json(CreateFieldInput) } },
  responses: {
    201: { description: 'Created', ...json(LoanFieldDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/loans/{id}/fields/{key}',
  operationId: 'updateLoanField',
  summary: 'Enable, disable or rename a field',
  description:
    'Needs `realestate.write` and the Pro plan. A disabled field keeps its values in every installment; it only stops counting in totals.',
  tags: ['Loans'],
  request: {
    params: Params.extend({ key: z.string() }),
    body: { required: true, ...json(UpdateFieldInput) },
  },
  responses: {
    200: { description: 'The updated field', ...json(LoanFieldDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans/{id}/events',
  operationId: 'listLoanEvents',
  summary: 'Events of a loan',
  description:
    'Any member of a Pro pool may read. In the order they take effect. `impact` says what each event did to the installment, the rate and the installments left from `impact.number` on.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'The events', ...json(EventListDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/loans/{id}/events',
  operationId: 'addLoanEvent',
  summary: 'Record a loan event',
  description:
    'Needs `realestate.write` and the Pro plan. `kind` is prepayment (amount, effect reduce_installment or reduce_term, optional fee), rate_review (annualRate, optional indexValue, spread and announced newInstallment) or renegotiation (annualRate and/or termMonths). `effectiveFrom` is the date from which the installments feel it; left out it is the first day of the next month for a prepayment and the date itself for the others. An event the loan cannot work with (an installment below the interest) answers 400.',
  tags: ['Loans'],
  request: { params: Params, body: { required: true, ...json(CreateEventInput) } },
  responses: {
    201: { description: 'Recorded', ...json(EventDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/loans/{id}/events/{eventId}',
  operationId: 'deleteLoanEvent',
  summary: 'Delete a loan event',
  description:
    'Needs `realestate.write` and the Pro plan. The projection goes back to what it was without the event.',
  tags: ['Loans'],
  request: { params: Params.extend({ eventId: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/loans/{id}/review-preview',
  operationId: 'getLoanReviewPreview',
  summary: 'Next review preview',
  description:
    'Only for a variable or mixed rate (400 otherwise). With the newest Euribor month the job has stored, the new rate (index plus spread, never below zero) and the installment it would give over the installments left. `newRate` and `newPayment` are null until the job has run.',
  tags: ['Loans'],
  request: { params: Params },
  responses: {
    200: { description: 'The preview', ...json(ReviewPreviewDto) },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});
