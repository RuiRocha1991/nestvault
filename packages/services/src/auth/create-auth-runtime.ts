import { parseKeyRing } from '@nestvault/crypto';
import { createIdentityDatabase } from '@nestvault/db';

import { createAccountService, type AccountService } from '../account';
import { createAccountsService, type AccountsService } from '../accounts';
import { createAssetsService, type AssetsService } from '../assets';
import { createAuditService, type AuditService } from '../audit';
import { createCategoriesService, type CategoriesService } from '../categories';
import type { EmailSender } from '../email';
import { createEntitlementsService, type EntitlementsService } from '../entitlements';
import { createExpensesService, type ExpensesService } from '../expenses';
import { createGoalsService, type GoalsService } from '../goals';
import { createHoldersService, type HoldersService } from '../holders';
import {
  createEncryptedFileStore,
  createImportsService,
  createParserClient,
  type ImportsService,
} from '../imports';
import {
  createCashMovesService,
  createOpsService,
  createPlansService,
  createPortfoliosService,
  type CashMovesService,
  type OpsService,
  type PlansService,
  type PortfoliosService,
} from '../investments';
import { createInvitesService, createInviteVerifier, type InvitesService } from '../invites';
import { createLoansService, type LoansService } from '../loans';
import type { Logger } from '../logger';
import { createMembersService, type MembersService } from '../members';
import { createMonthsService, type MonthsService } from '../months';
import { createNotesService, type NotesService } from '../notes';
import { createOverviewService, type OverviewService } from '../overview';
import { createPoolsService, type PoolsService } from '../pools';
import { createPropertiesService, type PropertiesService } from '../properties';
import { createPrototypeImportService, type PrototypeImportService } from '../prototype-import';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { createRulesService, type RulesService } from '../rules';
import {
  createDepositsService,
  createInterestService,
  createProductsService,
  type DepositsService,
  type InterestService,
  type ProductsService,
} from '../savings';
import { createSettingsService, type SettingsService } from '../settings';
import { createTransactionsService, type TransactionsService } from '../transactions';
import { createWorksService, type WorksService } from '../works';

import { createAuth, type Auth } from './create-auth';

export interface AuthRuntimeConfig {
  identityDatabaseUrl: string;
  appUrl: string;
  secret: string;
  allowSignup: boolean;
  /** `BILLING_ENABLED`: false (default) treats every pool as Pro. */
  billingEnabled?: boolean;
  trustedProxyHops?: number;
  email: EmailSender;
  log?: Logger;
  /** The statement import: the parser service, where files are kept and the key that locks them. */
  imports: {
    parserUrl: string;
    parserSecret: string;
    /** `APP_ENCRYPTION_KEY`: one key, or a list `new:<key>,old:<key>` for rotation. */
    encryptionKey: string;
    /** Absolute directory outside any web root. */
    storageDir: string;
  };
}

export interface AuthRuntime {
  auth: Auth;
  /** Same identity connection as `auth`: sessions, users and rate-limit counters share one pool. */
  limiter: RateLimiter;
  /** Profile and sessions of the signed-in user. */
  account: AccountService;
  /** Create, list and open the pools of the signed-in user. */
  pools: PoolsService;
  /** Invite members by email and accept invites. */
  invites: InvitesService;
  /** Roles, removal, leaving and ownership transfer of a pool's members. */
  members: MembersService;
  /** The pool's audit log for its owner. */
  audit: AuditService;
  /** Plan, limits and usage of a pool; also the checks the services call before inserting. */
  entitlements: EntitlementsService;
  /** Bank, savings, deposit and brokerage accounts with their holders and sub-accounts. */
  accounts: AccountsService;
  /** Bank movements: manual entry, categories by hand and transfers. */
  transactions: TransactionsService;
  expenses: ExpensesService;
  portfolios: PortfoliosService;
  ops: OpsService;
  /** Cash moves from a portfolio to a bank account. */
  cashMoves: CashMovesService;
  plans: PlansService;
  goals: GoalsService;
  /** Real estate (Pro): properties, their owners and valuations. */
  properties: PropertiesService;
  /** Loans and their installments (Pro). */
  loans: LoansService;
  /** Works projects with their payment phases (Pro). */
  works: WorksService;
  /** Savings products, term deposits and manual interest entries. */
  products: ProductsService;
  deposits: DepositsService;
  interest: InterestService;
  /** Notes on movements and operations, and month notes. */
  notes: NotesService;
  /** The overview screen in one read. */
  overview: OverviewService;
  /** The monthly review. */
  months: MonthsService;
  /** Keyword rules that categorize movements. */
  rules: RulesService;
  /** Assets (unique ticker per pool) and their price history. */
  assets: AssetsService;
  /** The global category catalogue plus the pool's own categories and settings. */
  categories: CategoriesService;
  /** The people of the household (owners of accounts). */
  holders: HoldersService;
  /** Pool settings and the FX rates the pool uses. */
  settings: SettingsService;
  /** Imports the prototype's JSON export into an empty pool (owner only). */
  prototypeImport: PrototypeImportService;
  /** Bank and broker statements: upload, preview and idempotent commit. */
  imports: ImportsService;
}

/** Opens the identity connection (`identity_rw`) and builds Better Auth and the rate limiter on it. */
export function createAuthRuntime(config: AuthRuntimeConfig): AuthRuntime {
  const identity = createIdentityDatabase(config.identityDatabaseUrl);
  const hops =
    config.trustedProxyHops !== undefined ? { trustedProxyHops: config.trustedProxyHops } : {};
  const limiter = createRateLimiter({
    identity,
    secret: config.secret,
    ...(config.log ? { log: config.log } : {}),
  });
  const auth = createAuth({
    identity,
    appUrl: config.appUrl,
    secret: config.secret,
    allowSignup: config.allowSignup,
    limiter,
    email: config.email,
    invites: createInviteVerifier(identity),
    ...hops,
    ...(config.log ? { log: config.log } : {}),
  });
  const pools = createPoolsService({ auth, identity, ...hops });
  const entitlements = createEntitlementsService({
    auth,
    identity,
    billingEnabled: config.billingEnabled ?? false,
  });
  return {
    auth,
    limiter,
    account: createAccountService({ auth, identity, pools, ...hops }),
    pools,
    entitlements,
    invites: createInvitesService({
      auth,
      identity,
      entitlements,
      limiter,
      email: config.email,
      appUrl: config.appUrl,
      ...hops,
    }),
    members: createMembersService({ auth, identity, limiter, ...hops }),
    audit: createAuditService({ auth, identity }),
    accounts: createAccountsService({ auth, identity, entitlements, ...hops }),
    transactions: createTransactionsService({ auth, identity, ...hops }),
    expenses: createExpensesService({ auth, identity, ...hops }),
    portfolios: createPortfoliosService({ auth, identity, entitlements, ...hops }),
    ops: createOpsService({ auth, identity, ...hops }),
    cashMoves: createCashMovesService({ auth, identity, ...hops }),
    plans: createPlansService({ auth, identity, ...hops }),
    goals: createGoalsService({ auth, identity, ...hops }),
    properties: createPropertiesService({ auth, identity, entitlements, ...hops }),
    loans: createLoansService({ auth, identity, entitlements, ...hops }),
    works: createWorksService({ auth, identity, entitlements, ...hops }),
    products: createProductsService({ auth, identity, ...hops }),
    deposits: createDepositsService({ auth, identity, ...hops }),
    interest: createInterestService({ auth, identity, ...hops }),
    notes: createNotesService({ auth, identity, ...hops }),
    overview: createOverviewService({ auth, identity, ...hops }),
    months: createMonthsService({ auth, identity, ...hops }),
    rules: createRulesService({ auth, identity, ...hops }),
    assets: createAssetsService({ auth, identity, ...hops }),
    categories: createCategoriesService({ auth, identity, ...hops }),
    holders: createHoldersService({ auth, identity, ...hops }),
    settings: createSettingsService({ auth, identity, ...hops }),
    prototypeImport: createPrototypeImportService({ auth, identity, limiter, ...hops }),
    imports: createImportsService({
      auth,
      identity,
      limiter,
      parser: createParserClient({
        url: config.imports.parserUrl,
        secret: config.imports.parserSecret,
      }),
      files: createEncryptedFileStore({
        dir: config.imports.storageDir,
        ring: parseKeyRing(config.imports.encryptionKey),
      }),
      ...hops,
    }),
  };
}
