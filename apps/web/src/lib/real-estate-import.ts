import type { RealEstateCommitResultDto, RealEstatePreviewDto } from '@nestvault/services';

import { readProblem, type ApiProblem } from '@webapp/lib/members-api';

// The calls of the spreadsheet import dialog (NES-102). Each answers the data or the problem and
// never throws: a network failure is a problem with status 0. Client components import the types
// from here, never the services root.

export type RealEstatePreview = RealEstatePreviewDto;
export type RealEstateCommitResult = RealEstateCommitResultDto;
export type Answer<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem };

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const NETWORK: ApiProblem = { status: 0, code: null, issuePaths: [], retryAfterSeconds: 0 };
const EXTENSION = /\.(xlsx|csv)$/i;

export const hasImportExtension = (fileName: string): boolean => EXTENSION.test(fileName);

const base = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}/real-estate-imports`;

export const templateUrl = (poolId: string, name: 'loan-installments' | 'works-payments') =>
  `${base(poolId)}/templates/${name}`;

export function importForm(
  file: File,
  target: { loanId: string | null; propertyId: string },
  update: boolean,
): FormData {
  const form = new FormData();
  form.set('file', file);
  if (target.loanId) form.set('loanId', target.loanId);
  form.set('propertyId', target.propertyId);
  form.set('update', update ? 'true' : 'false');
  return form;
}

async function send<T>(url: string, form: FormData): Promise<Answer<T>> {
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', body: form });
    if (!response.ok) return { ok: false, problem: await readProblem(response) };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, problem: NETWORK };
  }
}

export const previewImport = (poolId: string, form: FormData) =>
  send<RealEstatePreview>(`${base(poolId)}/preview`, form);

export const commitImport = (poolId: string, form: FormData) =>
  send<RealEstateCommitResult>(`${base(poolId)}/commit`, form);

/** The message key (under `realEstate.import.problem`) for a failed answer. */
export function importProblemKey(
  problem: ApiProblem,
): 'tooLarge' | 'unsupported' | 'unrecognised' | 'forbidden' | 'limit' | 'conflict' | 'generic' {
  switch (problem.status) {
    case 403:
      return 'forbidden';
    case 409:
      return 'conflict';
    case 413:
      return 'tooLarge';
    case 415:
      return 'unsupported';
    case 422:
      return 'unrecognised';
    case 429:
      return 'limit';
    default:
      return 'generic';
  }
}

export type PlanCounts = NonNullable<RealEstatePreview['plan']>['keep'];

/** Created, updated and already-there rows of a plan, over every kind the file can hold. */
export function planTotals(plan: PlanCounts) {
  const created =
    plan.installments.create +
    plan.prepayments.create +
    plan.works.create +
    plan.payments.create +
    (plan.costs === 'fill' ? 1 : 0);
  const updated =
    plan.installments.update +
    plan.works.update +
    plan.payments.update +
    (plan.costs === 'update' ? 1 : 0);
  const unchanged =
    plan.installments.unchanged +
    plan.prepayments.unchanged +
    plan.works.unchanged +
    plan.payments.unchanged;
  const rejected =
    plan.installments.rejected +
    plan.prepayments.rejected +
    plan.works.rejected +
    plan.payments.rejected +
    plan.costsRejected;
  return { created, updated, unchanged, rejected };
}

/** Parser warning codes (`snake_case` or `snake_case:count`) as message keys (`camelCase`). */
export const WARNING_KEYS = [
  'installmentsWithoutValues',
  'installmentsRepeated',
  'prepaymentsTableMissing',
  'worksTableMissing',
  'paymentsTableMissing',
  'inflationTableMissing',
  'paymentsPaidWithoutDate',
  'depositReadAsFraction',
  'depositOneReadAsPercent',
  'stampDutyNotFound',
  'rowsNotInstallments',
  'rowsNotPayments',
] as const;
export type WarningKey = (typeof WARNING_KEYS)[number] | 'unknown';

export function parseWarning(warning: string): { key: WarningKey; count: number } {
  const [code = '', count = '0'] = warning.split(':');
  const camel = code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const known = (WARNING_KEYS as readonly string[]).includes(camel);
  return { key: known ? (camel as WarningKey) : 'unknown', count: Number(count) || 0 };
}

/** The message key (under `realEstate.import.sheets`) of a sheet or CSV the parser names. */
const SHEET_KEYS: Readonly<Record<string, string>> = {
  Sumário: 'installments',
  Amortização: 'prepayments',
  Remodelações: 'works',
  Pagamentos: 'payments',
  Inflação: 'inflation',
  Installments: 'csvInstallments',
  Payments: 'csvPayments',
};
export const sheetKey = (sheet: string): string => SHEET_KEYS[sheet] ?? 'other';
