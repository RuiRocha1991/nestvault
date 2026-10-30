import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  createAuthRuntime,
  createSmtpSender,
  logger,
  type AccountService,
  type AuditService,
  type AccountsService,
  type CashMovesService,
  type OpsService,
  type EntitlementsService,
  type GoalsService,
  type LoansService,
  type PropertiesService,
  type PlansService,
  type ProductsService,
  type DepositsService,
  type InterestService,
  type MonthsService,
  type NotesService,
  type OverviewService,
  type PortfoliosService,
  type PrototypeImportService,
  type RulesService,
  type TransactionsService,
  type ExpensesService,
  type AssetsService,
  type CategoriesService,
  type HoldersService,
  type ImportsService,
  type Auth,
  type InvitesService,
  type MembersService,
  type PoolsService,
  type SettingsService,
  type AuthRuntime,
  type RateLimiter,
} from '@nestvault/services';

let instance: Promise<AuthRuntime> | undefined;

/** The repository root: the closest folder up from here with a `pnpm-workspace.yaml`. */
function repositoryRoot(): string {
  let folder = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(folder, 'pnpm-workspace.yaml'))) return folder;
    folder = dirname(folder);
  }
  return process.cwd();
}

/** `IMPORT_STORAGE_DIR` as an absolute path; a relative one is from the repository root. */
const storageDir = (value: string): string =>
  isAbsolute(value) ? value : resolve(repositoryRoot(), value);

/**
 * The one Better Auth instance and rate limiter of the web process. Built on first use (not at
 * import), so that building the app needs no environment and tests can mock this module. The
 * promise is cached, so concurrent first requests share one instance and one database pool.
 */
function getRuntime(): Promise<AuthRuntime> {
  instance ??= import('@nestvault/config').then(({ env }) => {
    if (env.NODE_ENV === 'production' && env.TRUSTED_PROXY_HOPS < 1) {
      logger.warn(
        'TRUSTED_PROXY_HOPS is 0 in production: the client IP is unknown, so the per-IP sign-in limit is shared and loose. Put the app behind a reverse proxy and set it.',
      );
    }
    return createAuthRuntime({
      identityDatabaseUrl: env.DATABASE_URL_IDENTITY,
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      allowSignup: env.ALLOW_SIGNUP,
      billingEnabled: env.BILLING_ENABLED,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
      email: createSmtpSender({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.SMTP_FROM,
        log: logger,
      }),
      log: logger,
      imports: {
        parserUrl: env.PARSER_URL,
        parserSecret: env.PARSER_SECRET,
        encryptionKey: env.APP_ENCRYPTION_KEY,
        storageDir: storageDir(env.IMPORT_STORAGE_DIR),
      },
    });
  });
  instance.catch(() => {
    instance = undefined;
  });
  return instance;
}

export async function getAuth(): Promise<Auth> {
  return (await getRuntime()).auth;
}

export async function getRateLimiter(): Promise<RateLimiter> {
  return (await getRuntime()).limiter;
}

export async function getAccountService(): Promise<AccountService> {
  return (await getRuntime()).account;
}

export async function getPoolsService(): Promise<PoolsService> {
  return (await getRuntime()).pools;
}

export async function getInvitesService(): Promise<InvitesService> {
  return (await getRuntime()).invites;
}

export async function getMembersService(): Promise<MembersService> {
  return (await getRuntime()).members;
}

export async function getAuditService(): Promise<AuditService> {
  return (await getRuntime()).audit;
}

export async function getAccountsService(): Promise<AccountsService> {
  return (await getRuntime()).accounts;
}

export async function getAssetsService(): Promise<AssetsService> {
  return (await getRuntime()).assets;
}

export async function getCategoriesService(): Promise<CategoriesService> {
  return (await getRuntime()).categories;
}

export async function getTransactionsService(): Promise<TransactionsService> {
  return (await getRuntime()).transactions;
}

export async function getExpensesService(): Promise<ExpensesService> {
  return (await getRuntime()).expenses;
}

export async function getRulesService(): Promise<RulesService> {
  return (await getRuntime()).rules;
}

export async function getHoldersService(): Promise<HoldersService> {
  return (await getRuntime()).holders;
}

export async function getSettingsService(): Promise<SettingsService> {
  return (await getRuntime()).settings;
}

export async function getPortfoliosService(): Promise<PortfoliosService> {
  return (await getRuntime()).portfolios;
}

export async function getOpsService(): Promise<OpsService> {
  return (await getRuntime()).ops;
}

export async function getEntitlementsService(): Promise<EntitlementsService> {
  return (await getRuntime()).entitlements;
}

export async function getPropertiesService(): Promise<PropertiesService> {
  return (await getRuntime()).properties;
}

export async function getLoansService(): Promise<LoansService> {
  return (await getRuntime()).loans;
}

export async function getGoalsService(): Promise<GoalsService> {
  return (await getRuntime()).goals;
}

export async function getPlansService(): Promise<PlansService> {
  return (await getRuntime()).plans;
}

export async function getProductsService(): Promise<ProductsService> {
  return (await getRuntime()).products;
}

export async function getDepositsService(): Promise<DepositsService> {
  return (await getRuntime()).deposits;
}

export async function getOverviewService(): Promise<OverviewService> {
  return (await getRuntime()).overview;
}

export async function getNotesService(): Promise<NotesService> {
  return (await getRuntime()).notes;
}

export async function getInterestService(): Promise<InterestService> {
  return (await getRuntime()).interest;
}

export async function getCashMovesService(): Promise<CashMovesService> {
  return (await getRuntime()).cashMoves;
}

export async function getPrototypeImportService(): Promise<PrototypeImportService> {
  return (await getRuntime()).prototypeImport;
}

export async function getMonthsService(): Promise<MonthsService> {
  return (await getRuntime()).months;
}

export async function getImportsService(): Promise<ImportsService> {
  return (await getRuntime()).imports;
}
