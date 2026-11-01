import {
  loanEventsRepo,
  loansRepo,
  newId,
  propertiesRepo,
  withPool,
  worksRepo,
  type IdentityDatabase,
  type LoanRow,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type PropertyRow,
} from '@nestvault/db';
import { compoundInflation, dec, toPlain } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isUniqueViolation } from '../db-errors';
import type { Entitlements } from '../entitlements';
import {
  ConflictError,
  PayloadTooLargeError,
  UnprocessableError,
  UnsupportedMediaTypeError,
} from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { sniffUpload, cleanFileName } from '../imports/file-type';
import type { UploadInput } from '../imports/imports-service';
import type { RealEstateParserClient, RealEstateParserResponse } from '../imports/parser-client';
import { invalid } from '../investments/checks';
import { IMPORT_MAX_BYTES } from '../prototype-import/schema';
import { clientIpResolver, type RateLimiter } from '../rate-limit';
import { zodProblem } from '../zod-problem';

import { fieldsWithValues, planImport, type Plan, type PlanState } from './plan';
import {
  PlanCountsDto,
  RealEstateCommitResultDto,
  RealEstatePreviewDto,
  UploadFields,
} from './schemas';
import { TEMPLATE_FILE_NAMES, templateText } from './templates';

export interface RealEstateImportsService {
  /**
   * Reads a spreadsheet or a CSV template and answers with what it holds and, when a loan and a
   * property are named, what importing would do. Nothing is written (`imports.run`, Pro).
   */
  preview(
    headers: Headers,
    poolId: string,
    read: () => Promise<UploadInput>,
  ): Promise<RealEstatePreviewDto>;
  /**
   * Reads the file again and writes what the preview showed, in one transaction. Rows that are
   * already there are left alone, so importing the same file twice adds nothing
   * (`imports.run` and `realestate.write`, Pro).
   */
  commit(
    headers: Headers,
    poolId: string,
    read: () => Promise<UploadInput>,
  ): Promise<RealEstateCommitResultDto>;
  /** One of the two CSV templates (`imports.run`, Pro). */
  template(
    headers: Headers,
    poolId: string,
    name: string,
  ): Promise<{ fileName: string; text: string }>;
}

export interface RealEstateImportsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  limiter: RateLimiter;
  parser: RealEstateParserClient;
  /** Real estate is a Pro feature (ADR 0003). */
  entitlements: Entitlements;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

type Response = RealEstateParserResponse;
type Row = Response['rows'][number];
type Of<K extends Row['kind']> = Extract<Row, { kind: K }>;

const propertyValues = (row: PropertyRow) => ({
  name: row.name,
  type: row.type,
  address: row.address,
  purchaseDate: row.purchaseDate,
  purchasePrice: row.purchasePrice,
  downPayment: row.downPayment,
  deedCost: row.deedCost,
  imt: row.imt,
  stampDuty: row.stampDuty,
  registrationCost: row.registrationCost,
  bankFees: row.bankFees,
  sellingCostPct: row.sellingCostPct,
  includeInNetWorth: row.includeInNetWorth,
});

/** What the plan does, as the counts the dialog shows. */
export function countsOf(plan: Plan): PlanCountsDto {
  return PlanCountsDto.parse({
    installments: {
      create: plan.installments.create.length,
      update: plan.installments.update.length,
      unchanged: plan.installments.unchanged,
      rejected: plan.installments.rejected,
    },
    prepayments: { create: plan.prepayments.create.length, unchanged: plan.prepayments.unchanged },
    works: {
      create: plan.works.create.length,
      update: plan.works.update.length,
      unchanged: plan.works.unchanged,
      rejected: plan.works.rejected,
    },
    payments: {
      create: plan.payments.create.length,
      update: plan.payments.update.length,
      unchanged: plan.payments.unchanged,
      rejected: plan.payments.rejected,
      kept: plan.payments.kept,
    },
    costs: plan.costs.action,
    fieldsEnabled: plan.enableFields,
    inflation: plan.inflation,
  });
}

/** The preview of a parsed file: what it holds, the totals and the two notices of the dialog. */
export function previewOf(
  response: Response,
  info: { fileName: string; confidence: number },
  plan: Plan | null,
): RealEstatePreviewDto {
  const rows = response.rows;
  const installments = rows.filter((row): row is Of<'installment'> => row.kind === 'installment');
  const prepayments = rows.filter((row): row is Of<'prepayment'> => row.kind === 'prepayment');
  const works = rows.filter((row): row is Of<'work'> => row.kind === 'work');
  const payments = rows.filter((row): row is Of<'work_payment'> => row.kind === 'work_payment');
  const inflation = rows.filter((row): row is Of<'inflation'> => row.kind === 'inflation');
  const total = (values: Iterable<string>) => {
    let sum = dec(0);
    for (const value of values) sum = sum.plus(value);
    return toPlain(sum);
  };
  const creditInsurance = total(installments.map((row) => row.credit_insurance));
  const compounded =
    inflation.length > 0
      ? compoundInflation(inflation.map((row) => ({ year: row.year, ratePct: row.rate_pct })))
      : null;
  const costs = response.meta.acquisition_costs;
  return RealEstatePreviewDto.parse({
    fileName: info.fileName,
    parserId: response.meta.parser_id,
    parserVersion: response.meta.parser_version,
    confidence: info.confidence,
    rowCount: rows.length,
    sheets: response.meta.sheets,
    totals: {
      installments: installments.length,
      capital: total(installments.map((row) => row.capital)),
      interest: total(installments.map((row) => row.interest)),
      prepayments: total(prepayments.map((row) => row.amount)),
      works: total(works.map((row) => row.budget)),
      payments: total(payments.map((row) => row.amount)),
      creditInsurance,
    },
    costs: costs && {
      deed: costs.deed,
      imt: costs.imt,
      stampDuty: costs.stamp_duty,
      registration: costs.registration,
      bankFees: costs.bank_fees,
      total: total([costs.deed, costs.imt, costs.stamp_duty, costs.registration, costs.bank_fees]),
    },
    fieldsWithValues: fieldsWithValues(rows),
    inflation:
      compounded && inflation.length > 0
        ? {
            rows: inflation.map((row) => ({ year: row.year, ratePct: row.rate_pct })),
            compoundedPct: compounded.compoundedPct,
            summedPct: compounded.summedPct,
          }
        : null,
    notices: {
      creditInsurance: dec(creditInsurance).gt(0) ? creditInsurance : null,
      inflationSummed: inflation.length > 1,
    },
    warnings: response.warnings,
    plan: plan && countsOf(plan),
    needs: {
      loan: installments.length > 0 || prepayments.length > 0,
      property: works.length > 0 || payments.length > 0 || costs !== null,
    },
  });
}

export function createRealEstateImportsService(
  deps: RealEstateImportsServiceDeps,
): RealEstateImportsService {
  const { auth, identity, limiter, parser, entitlements } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());

  /** Session, membership, permission(s) and plan, in that order. */
  async function guard(headers: Headers, poolId: string, writes: boolean) {
    const session = await requireSession(auth, headers);
    const ctx = await requirePoolAccess(identity, session, poolId);
    can(ctx, 'imports.run');
    if (writes) can(ctx, 'realestate.write');
    await entitlements.assertFeature(ctx, 'real_estate');
    return ctx;
  }

  /** The upload: size, fields, content type, then the parser service. */
  async function readFile(read: () => Promise<UploadInput>) {
    const upload = await read();
    if (upload.bytes.length > IMPORT_MAX_BYTES) throw new PayloadTooLargeError();
    const fields = UploadFields.safeParse(upload.fields);
    if (!fields.success) throw zodProblem(fields.error, upload.fields);
    const fileName = cleanFileName(upload.fileName);
    if (sniffUpload(upload.bytes, fileName) === 'pdf') {
      throw new UnsupportedMediaTypeError('Upload an .xlsx workbook or a .csv template.');
    }
    const [best] = await parser.detectRealEstate(upload.bytes);
    if (!best) throw new UnprocessableError('The file is not a real estate spreadsheet.');
    const response = await parser.parseRealEstate(upload.bytes, best.parser_id);
    return { fields: fields.data, fileName, confidence: best.confidence, response };
  }

  async function findLoan(tx: PoolTx, ctx: PoolContext, id: string | undefined) {
    if (id === undefined) return null;
    const loan = await loansRepo.find(tx, ctx, id.toLowerCase());
    if (!loan) throw invalid('loanId', 'not a loan of this pool');
    return loan;
  }

  async function findProperty(
    tx: PoolTx,
    ctx: PoolContext,
    id: string | undefined,
    loan: LoanRow | null,
  ) {
    const wanted = id ?? loan?.propertyId ?? undefined;
    if (wanted === undefined) return null;
    const property = await propertiesRepo.find(tx, ctx, wanted.toLowerCase());
    if (!property) throw invalid('propertyId', 'not a property of this pool');
    return property;
  }

  async function loadState(tx: PoolTx, ctx: PoolContext, fields: UploadFields): Promise<PlanState> {
    const loan = await findLoan(tx, ctx, fields.loanId);
    const property = await findProperty(tx, ctx, fields.propertyId, loan);
    const works = property ? await worksRepo.listProjects(tx, ctx, property.id) : [];
    return {
      loan,
      property,
      installments: loan ? await loansRepo.listInstallments(tx, ctx, loan.id) : [],
      prepayments: loan
        ? (await loanEventsRepo.list(tx, ctx, loan.id)).filter((e) => e.kind === 'prepayment')
        : [],
      fields: loan ? await loansRepo.listFields(tx, ctx, [loan.id]) : [],
      works,
      payments: await worksRepo.listPayments(
        tx,
        ctx,
        works.map((work) => work.id),
      ),
      today: now().toISOString().slice(0, 10),
    };
  }

  /** Writes the plan. The caller runs it in `withPool`, so a failure undoes all of it. */
  async function apply(tx: PoolTx, ctx: PoolContext, state: PlanState, plan: Plan) {
    const { loan, property } = state;
    if (loan) {
      for (const values of plan.installments.create) {
        await loansRepo.insertInstallment(tx, ctx, loan.id, newId(), values);
      }
      for (const { id, values } of plan.installments.update) {
        await loansRepo.updateInstallment(tx, ctx, loan.id, id, values);
      }
      for (const key of plan.enableFields) {
        const field = state.fields.find((candidate) => candidate.key === key);
        if (!field) continue;
        await loansRepo.updateField(tx, ctx, loan.id, key, {
          label: field.label,
          enabled: true,
          countsAsExpense: field.countsAsExpense,
          defaultAmount: field.defaultAmount,
          appliesFrom: field.appliesFrom,
        });
      }
      for (const values of plan.prepayments.create) {
        await loanEventsRepo.insert(tx, ctx, loan.id, newId(), values);
      }
    }
    if (property) {
      if (plan.costs.action === 'fill' || plan.costs.action === 'update') {
        await propertiesRepo.update(tx, ctx, property.id, {
          ...propertyValues(property),
          ...plan.costs.values,
        });
      }
      const created = new Map<string, string>();
      for (const { key, values } of plan.works.create) {
        const id = newId();
        await worksRepo.insertProject(tx, ctx, id, values);
        created.set(key, id);
      }
      for (const { id, values } of plan.works.update) {
        await worksRepo.updateProject(tx, ctx, id, values);
      }
      for (const { projectId, projectKey, values } of plan.payments.create) {
        const owner = projectId ?? created.get(projectKey);
        if (owner) await worksRepo.insertPayment(tx, ctx, owner, newId(), values);
      }
      for (const { projectId, id, values } of plan.payments.update) {
        await worksRepo.updatePayment(tx, ctx, projectId, id, values);
      }
    }
  }

  const needsError = (plan: Plan) => {
    if (plan.missing.loan) return invalid('loanId', 'choose the loan this file belongs to');
    if (plan.missing.property) {
      return invalid('propertyId', 'choose the property (or a loan that belongs to one)');
    }
    return null;
  };

  return {
    async preview(headers, poolId, read) {
      const ctx = await guard(headers, poolId, false);
      await limiter.consume('imports', ctx.poolId);
      const file = await readFile(read);
      const chosen = file.fields.loanId !== undefined || file.fields.propertyId !== undefined;
      const plan = chosen
        ? await run(ctx, async (tx) =>
            planImport(file.response, await loadState(tx, ctx, file.fields), {
              update: file.fields.update === 'true',
            }),
          )
        : null;
      return previewOf(file.response, file, plan);
    },

    async commit(headers, poolId, read) {
      const ctx = await guard(headers, poolId, true);
      await limiter.consume('imports', ctx.poolId);
      const file = await readFile(read);
      const outcome = await run(ctx, async (tx) => {
        const state = await loadState(tx, ctx, file.fields);
        const plan = planImport(file.response, state, { update: file.fields.update === 'true' });
        const problem = needsError(plan);
        if (problem) throw problem;
        await apply(tx, ctx, state, plan);
        return { state, counts: countsOf(plan) };
      }).catch((error: unknown) => {
        // Another import of the same loan got there first.
        if (isUniqueViolation(error)) throw new ConflictError('This loan was changed meanwhile.');
        throw error;
      });
      const { counts } = outcome;
      const written =
        counts.installments.create +
        counts.installments.update +
        counts.prepayments.create +
        counts.works.create +
        counts.works.update +
        counts.payments.create +
        counts.payments.update;
      await recordAudit(identity, ctx, 'import.realestate_committed', {
        target: outcome.state.loan?.id ?? outcome.state.property?.id ?? null,
        // Rows written, all kinds together: the audit log keeps counts, never content.
        meta: { count: written },
        ip: ipOf(headers),
      });
      return RealEstateCommitResultDto.parse({
        fileName: file.fileName,
        parserId: file.response.meta.parser_id,
        loanId: outcome.state.loan?.id ?? null,
        propertyId: outcome.state.property?.id ?? null,
        result: outcome.counts,
      });
    },

    async template(headers, poolId, name) {
      await guard(headers, poolId, false);
      const { name: key, text } = templateText(name);
      return { fileName: TEMPLATE_FILE_NAMES[key], text };
    },
  };
}
