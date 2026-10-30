import { expect } from 'vitest';
import type { z } from 'zod';

import {
  CashMoveDto,
  CashMoveListDto,
  AcceptInviteDto,
  AccountDto,
  AccountListDto,
  AccountsScreenDto,
  ApplyRulesDto,
  OpDto,
  OpListDto,
  PlanDto,
  PlanListDto,
  PlanRunDto,
  ProductDto,
  ProductListDto,
  DepositDto,
  DepositListDto,
  DepositScheduleDto,
  InterestEntryDto,
  InterestListDto,
  MonthNoteDto,
  MonthReviewDto,
  MonthNoteListDto,
  NoteDto,
  PortfolioDto,
  PortfolioListDto,
  OverviewDto,
  PortfolioSummaryDto,
  RuleDto,
  RuleListDto,
  TransactionDto,
  TransactionPageDto,
  CategoryDto,
  GoalDto,
  PoolPlanDto,
  PropertyDto,
  EventDto,
  EventListDto,
  InstallmentDto,
  InstallmentListDto,
  LoanDto,
  PaymentDto,
  UpcomingDto,
  WorkDto,
  WorkListDto,
  CostDto,
  CostListDto,
  CostPaymentDto,
  CostTotalsDto,
  UpcomingCostsDto,
  LoanFieldDto,
  LoanListDto,
  PropertyListDto,
  ReviewPreviewDto,
  ScheduleDto,
  ValuationDto,
  ValuationListDto,
  GoalListDto,
  CategoryListDto,
  ExpensesSummaryDto,
  ExpensesUsageDto,
  MovementTotalsDto,
  AssetDto,
  AssetListDto,
  BulkPricesDto,
  PriceDto,
  PriceHistoryDto,
  SubAccountDto,
  HolderDto,
  HolderListDto,
  ImportResultDto,
  CommitImportResultDto,
  ImportHistoryDto,
  ImportPreviewDto,
  MergePreviewDto,
  InviteDto,
  InviteListDto,
  MemberListDto,
  MemberRoleDto,
  MeDto,
  MeWithPoolsDto,
  PoolSummaryDto,
  FxDto,
  RevokedSessionsDto,
  SessionListDto,
  SettingsDto,
  TransferOwnershipDto,
  type Permission,
} from '@nestvault/services';

import type { Persona, Scenario } from './api-world';
import { PASSWORD } from './auth-harness';
import type { HttpMethod } from './route-files';

// The route registry of the isolation suite (docs/testing.md, NES-30). Every Route Handler under
// `app/api/v1` has one entry; `tests/web/route-registry.test.ts` fails when a handler is missing,
// and `tests/web/route-isolation.integration.test.ts` generates the authorization and isolation
// cases of every entry against the real services and Postgres.
//
// To add a route: copy the entry of a similar one, set `permission` to what the service checks with
// `can()`, give a valid `body`/`params`, the success `schema` (the DTO) and, when the URL names a
// resource, `foreign` (the same kind of resource in pool B). Nothing else is needed: the cases are
// generated.

export type RouteModule = Partial<
  Record<
    HttpMethod,
    (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
  >
>;

/** What a route handler file exports; cast once here because each file types its own params. */
const load = <T>(module: Promise<T>) => module as unknown as Promise<RouteModule>;

/** The same kind of resource, but living in pool B (or belonging to another user). */
export interface Foreign {
  params?: Record<string, string>;
  body?: unknown;
  /** Asserts that the resource was not touched by the rejected call. */
  unchanged: () => Promise<void>;
}

export interface Negative {
  name: string;
  as?: Persona;
  body?: unknown;
  query?: string;
  expect: number;
}

interface Base {
  method: HttpMethod;
  /** As on disk: `/api/v1/pools/:poolId/members`. */
  path: string;
  load: () => Promise<RouteModule>;
}

interface Exercised {
  /** Valid path parameters besides `poolId` (ids that belong to the scenario's pool A). */
  params?: (s: Scenario) => Promise<Record<string, string>>;
  /** A valid body. Its presence means the route reads a body, so extra fields must answer 400. */
  body?: (s: Scenario) => unknown;
  /** A fixed query string, or one built from the scenario (when it names an id). */
  query?: string | ((s: Scenario) => Promise<string>);
  /** Sets up what the success case needs beyond the scenario (runs right before it). */
  prepare?: (s: Scenario) => Promise<void>;
  success: {
    status: number;
    /** The DTO the body is parsed with, with every object closed. */
    schema?: z.ZodType;
    check?: (s: Scenario, body: unknown) => Promise<void>;
  };
  foreign?: (s: Scenario) => Promise<Foreign>;
  /** Required when there is no `foreign`: why no id of another pool can be sent. */
  noForeignBecause?: string;
  /** Strings from pool B (or other users) that must not appear anywhere in the response. */
  leaks?: (s: Scenario) => Promise<string[]>;
  negatives?: Negative[];
}

export interface PoolRoute extends Base, Exercised {
  scope: 'pool';
  /** What the service checks with `can()`. The lowest role holding it must succeed, lower ones get 403. */
  permission: Permission;
}

export interface UserRoute extends Base, Exercised {
  scope: 'user';
  /** The signed-in user the cases run as. */
  caller: Persona;
}

export interface ExemptRoute extends Base {
  scope: 'exempt';
  reason: string;
}

export type RouteSpec = PoolRoute | UserRoute | ExemptRoute;

export const keyOf = (spec: Pick<Base, 'method' | 'path'>) => `${spec.method} ${spec.path}`;

const POOL = '/api/v1/pools/:poolId';

/** The scenario's pending invite in pool A or B, made once. */
const pendingInvite = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`invite-${pool}`, () => s.invite(pool));
/** A second session of the owner, made once. */
const ownerExtraSession = (s: Scenario) => s.memo('extra-session', () => s.extraSession('owner'));

/** A member of pool B only, addressed through pool A's URL: must answer 404 and keep their role. */
const foreignMember = (s: Scenario): Promise<Foreign> =>
  Promise.resolve({
    params: { userId: s.ids.bMember },
    unchanged: async () => {
      expect(await s.roleOf(s.poolB, 'bMember')).toBe('member');
    },
  });

/** A holder in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const holderIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`holder-${pool}`, async () =>
    s.world.holders.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { name: 'Ana Alfa', aliases: ['ana alfa'] }
        : { name: 'Bruno Beta', aliases: ['bruno beta'] },
    ),
  );

/** The person of the pool A member `member`: the usual target of a merge. */
const memberHolderOf = async (s: Scenario) => {
  const { holders } = await s.world.holders.list(await s.as('owner'), s.poolA);
  const found = holders.find((holder) => holder.userId === s.ids.member);
  if (!found) throw new Error('the member has no person');
  return found;
};

/** The holder of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignHolder = async (s: Scenario): Promise<Foreign> => {
  const other = await holderIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.holders.list(await s.as('outsider'), s.poolB);
      expect(seen.holders.find((holder) => holder.id === other.id)).toEqual(other);
    },
  };
};

/** An account in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const accountIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`account-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [holder] = (await s.world.holders.list(headers, poolId)).holders;
    return s.world.accounts.create(headers, poolId, {
      type: 'brokerage',
      name: pool === 'A' ? 'Conta Alfa' : 'Conta Beta',
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
  });

/** A sub-account of the brokerage account in pool A or B, made once per scenario. */
const subAccountIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`sub-account-${pool}`, async () => {
    const account = await accountIn(s, pool);
    return s.world.accounts.createSubAccount(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      account.id,
      { name: pool === 'A' ? 'Sub Alfa' : 'Sub Beta' },
    );
  });

/** The account of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignAccount = async (s: Scenario): Promise<Foreign> => {
  const other = await accountIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.accounts.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** The sub-account of pool B under pool B's account, addressed through pool A's URL. */
const foreignSubAccount = async (s: Scenario): Promise<Foreign> => {
  const other = await subAccountIn(s, 'B');
  return {
    params: { id: other.accountId, subId: other.id },
    unchanged: async () => {
      const seen = await s.world.accounts.get(await s.as('outsider'), s.poolB, other.accountId);
      expect(seen.subAccounts).toContainEqual(other);
    },
  };
};

/** A property in pool A or pool B (owned 100% by the pool's first person), made once per scenario. */
const propertyIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`property-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [holder] = (await s.world.holders.list(headers, poolId)).holders;
    return s.world.properties.create(headers, poolId, {
      name: pool === 'A' ? 'Apartamento Alfa' : 'Apartamento Beta Secreto',
      type: 'primary_home',
      purchaseDate: '2020-09-01',
      purchasePrice: pool === 'A' ? '124000' : '987654',
      holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
    });
  });

/** The property of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignProperty = async (s: Scenario): Promise<Foreign> => {
  const other = await propertyIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.properties.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A valuation of the property in pool A or pool B, made once per scenario. */
const valuationIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`valuation-${pool}`, async () => {
    const property = await propertyIn(s, pool);
    return s.world.properties.addValuation(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      property.id,
      { date: '2025-01-01', value: pool === 'A' ? '150000' : '777777' },
    );
  });

/** The valuation of pool B's property, addressed through pool A's URL. */
const foreignValuation = async (s: Scenario): Promise<Foreign> => {
  const other = await valuationIn(s, 'B');
  return {
    params: { id: other.propertyId, valuationId: other.id },
    unchanged: async () => {
      const seen = await s.world.properties.listValuations(
        await s.as('outsider'),
        s.poolB,
        other.propertyId,
      );
      expect(seen.valuations).toContainEqual(other);
    },
  };
};

/** A loan in pool A or pool B, made once per scenario. */
const loanIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`loan-${pool}`, async () =>
    s.world.loans.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        name: pool === 'A' ? 'Crédito Alfa' : 'Crédito Beta Secreto',
        kind: 'mortgage',
        principal: pool === 'A' ? '111600' : '876543',
        startDate: '2020-09-01',
        firstDueDate: '2020-10-05',
        termMonths: 480,
        rateType: 'fixed',
        annualRate: '1.5',
        paymentDay: 5,
      },
    ),
  );

/** A variable-rate loan in pool A, for the review preview. */
const variableLoanIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`variable-loan-${pool}`, async () =>
    s.world.loans.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        name: 'Crédito variável',
        kind: 'mortgage',
        principal: '90000',
        startDate: '2021-01-01',
        firstDueDate: '2021-02-05',
        termMonths: 360,
        rateType: 'variable',
        rateIndex: 'euribor_6m',
        spread: '1.2',
        annualRate: '1.2',
        reviewMonths: 6,
        paymentDay: 5,
      },
    ),
  );

/** The loan of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignLoan = async (s: Scenario): Promise<Foreign> => {
  const other = await loanIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.loans.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** An installment of the loan in pool A or pool B, made once per scenario. */
const installmentIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`installment-${pool}`, async () => {
    const loan = await loanIn(s, pool);
    return s.world.loans.addInstallment(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      loan.id,
      { number: 1, dueDate: '2020-10-05', capital: '300', interest: pool === 'A' ? '140' : '999' },
    );
  });

/** The installment of pool B's loan, addressed through pool A's URL. */
const foreignInstallment = async (s: Scenario): Promise<Foreign> => {
  const other = await installmentIn(s, 'B');
  return {
    params: { id: other.loanId, installmentId: other.id },
    unchanged: async () => {
      const seen = await s.world.loans.listInstallments(
        await s.as('outsider'),
        s.poolB,
        other.loanId,
      );
      expect(seen.installments).toContainEqual(other);
    },
  };
};

/** An event of the loan in pool A or pool B, made once per scenario. */
const eventIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`loan-event-${pool}`, async () => {
    const loan = await loanIn(s, pool);
    return s.world.loans.addEvent(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      loan.id,
      {
        kind: 'prepayment',
        date: '2023-02-01',
        amount: pool === 'A' ? '15000' : '654321',
        effect: 'reduce_installment',
      },
    );
  });

/** The event of pool B's loan, addressed through pool A's URL. */
const foreignEvent = async (s: Scenario): Promise<Foreign> => {
  const other = await eventIn(s, 'B');
  return {
    params: { id: other.loanId, eventId: other.id },
    unchanged: async () => {
      const seen = await s.world.loans.listEvents(await s.as('outsider'), s.poolB, other.loanId);
      expect(seen.events.map((event) => event.id)).toContain(other.id);
    },
  };
};

/** A works project in pool A or pool B, made once per scenario. */
const workIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`work-${pool}`, async () =>
    s.world.works.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        propertyId: (await propertyIn(s, pool)).id,
        name: pool === 'A' ? 'Cozinha Alfa' : 'Cozinha Beta Secreta',
        supplier: pool === 'A' ? 'Fornecedor Alfa' : 'Fornecedor Beta Secreto',
        budget: pool === 'A' ? '9166' : '876543',
      },
    ),
  );

/** The project of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignWork = async (s: Scenario): Promise<Foreign> => {
  const other = await workIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.works.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A payment phase of the project in pool A or pool B, made once per scenario. */
const phaseIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`work-phase-${pool}`, async () => {
    const work = await workIn(s, pool);
    return s.world.works.addPayment(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      work.id,
      {
        description: pool === 'A' ? 'Sinal' : 'Sinal Secreto',
        amount: pool === 'A' ? '4900' : '654321',
        plannedDate: '2026-11-15',
      },
    );
  });

/** The phase of pool B's project, addressed through pool A's URL. */
const foreignPhase = async (s: Scenario): Promise<Foreign> => {
  const other = await phaseIn(s, 'B');
  return {
    params: { id: other.projectId, paymentId: other.id },
    unchanged: async () => {
      const seen = await s.world.works.get(await s.as('outsider'), s.poolB, other.projectId);
      expect(seen.phases).toContainEqual(other);
    },
  };
};

/** A recurring property cost in pool A or pool B, made once per scenario. */
const costIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`property-cost-${pool}`, async () =>
    s.world.propertyCosts.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        propertyId: (await propertyIn(s, pool)).id,
        kind: 'other',
        name: pool === 'A' ? 'Jardim Alfa' : 'Jardim Beta Secreto',
        amount: pool === 'A' ? '150' : '987654',
        periodicity: 'annual',
        startDate: '2026-03-15',
      },
    ),
  );

/** The cost of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignCost = async (s: Scenario): Promise<Foreign> => {
  const other = await costIn(s, 'B');
  return {
    params: { id: other.id, dueDate: other.startDate },
    unchanged: async () => {
      const seen = await s.world.propertyCosts.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** An asset in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const assetIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`asset-${pool}`, async () =>
    s.world.assets.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { ticker: 'ALFAFUND', name: 'Alfa Fund', type: 'etf', currency: 'EUR' }
        : { ticker: 'BETACORP', name: 'Beta Corp', type: 'stock', currency: 'USD' },
    ),
  );

/** The asset of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignAsset = async (s: Scenario): Promise<Foreign> => {
  const other = await assetIn(s, 'B');
  return {
    params: { id: other.id, date: '2026-01-02' },
    unchanged: async () => {
      const seen = await s.world.assets.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A category of pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const categoryIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`category-${pool}`, async () =>
    s.world.categories.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      { name: pool === 'A' ? 'Categoria Alfa' : 'Categoria Beta', kind: 'expense' },
    ),
  );

/** The category of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignCategory = async (s: Scenario): Promise<Foreign> => {
  const other = await categoryIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = (await s.world.categories.list(await s.as('outsider'), s.poolB)).categories;
      expect(seen.find((category) => category.id === other.id)).toEqual(other);
    },
  };
};

/** An account in pool A or B (owned by their first person), made once per scenario. */
const txAccountIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`tx-account-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [holder] = (await s.world.holders.list(headers, poolId)).holders;
    return s.world.accounts.create(headers, poolId, {
      type: 'checking',
      name: pool === 'A' ? 'Conta Movimentos A' : 'Conta Movimentos B',
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
  });

/** A movement in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const transactionIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`transaction-${pool}`, async () =>
    s.world.transactions.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        accountId: (await txAccountIn(s, pool)).id,
        date: '2026-03-10',
        description: pool === 'A' ? 'Movimento Alfa Secreto' : 'Movimento Beta Secreto',
        amount: pool === 'A' ? '-12.5' : '-98.76',
      },
    ),
  );

/** The movement of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignTransaction = async (s: Scenario): Promise<Foreign> => {
  const other = await transactionIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.transactions.list(await s.as('outsider'), s.poolB);
      expect(seen.transactions.find((entry) => entry.id === other.id)).toEqual(other);
    },
  };
};

/** A pending statement import in pool A (made by its owner) or pool B (made by `outsider`). */
const importIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`import-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const result = await s.world.imports.start(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      poolId,
      () =>
        Promise.resolve({
          fileName: 'extrato.csv',
          bytes: Buffer.from('Data;Descrição;Valor\n05-01-2026;Coffee;-1,20\n'),
          fields: {},
        }),
    );
    if (result.status !== 'preview') throw new Error('the import did not reach a preview');
    return result;
  });

/** The pending import of pool B, addressed through pool A's URL: 404, and it stays pending. */
const foreignImport = async (s: Scenario): Promise<Foreign> => {
  const other = await importIn(s, 'B');
  return {
    params: { batchId: other.batchId },
    unchanged: async () => {
      const seen = await s.world.imports.get(await s.as('outsider'), s.poolB, other.batchId);
      expect(seen.batchId).toBe(other.batchId);
    },
  };
};

/** A checking account in pool A to commit an import into. */
const importTarget = (s: Scenario) => txAccountIn(s, 'A');

/** A keyword rule in pool A or B (global category), made once per scenario. */
const ruleIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`rule-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [category] = (await s.world.categories.list(headers, poolId)).categories;
    return s.world.rules.create(headers, poolId, {
      keyword: pool === 'A' ? 'REPSOL' : 'GALPENERGIA',
      categoryId: category?.id ?? '',
    });
  });

/** The rule of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignRule = async (s: Scenario): Promise<Foreign> => {
  const other = await ruleIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.rules.list(await s.as('outsider'), s.poolB);
      expect(seen.rules).toContainEqual(other);
    },
  };
};

/** A portfolio in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const portfolioIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`portfolio-${pool}`, async () =>
    s.world.portfolios.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { name: 'Carteira Alfa Secreta', color: '#112233', currency: 'EUR' }
        : { name: 'Carteira Beta Secreta', color: '#445566', currency: 'USD' },
    ),
  );

/** The portfolio of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignPortfolio = async (s: Scenario): Promise<Foreign> => {
  const other = await portfolioIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.portfolios.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A buy in pool A or pool B (their portfolio and asset), made once per scenario. */
const opIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`op-${pool}`, async () =>
    s.world.ops.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        portfolioId: (await portfolioIn(s, pool)).id,
        assetId: (await assetIn(s, pool)).id,
        type: 'buy',
        date: '2026-02-10',
        qty: pool === 'A' ? '3' : '7',
        price: '10',
        note: pool === 'A' ? 'Nota Alfa Secreta' : 'Nota Beta Secreta',
      },
    ),
  );

/** The operation of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignOp = async (s: Scenario): Promise<Foreign> => {
  const other = await opIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.ops.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A dividend in the portfolio of pool A or B, so it holds cash to move, made once per scenario. */
const cashIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`cash-${pool}`, async () =>
    s.world.ops.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        portfolioId: (await portfolioIn(s, pool)).id,
        assetId: (await assetIn(s, pool)).id,
        type: 'dividend',
        date: '2026-02-11',
        amount: '500',
      },
    ),
  );

/** A cash move (with a mirror) from the portfolio of pool A or B to a checking account. */
const cashMoveIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`cash-move-${pool}`, async () => {
    await cashIn(s, pool);
    return s.world.cashMoves.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      (await portfolioIn(s, pool)).id,
      {
        accountId: (await cashAccountIn(s, pool, 'checking')).id,
        date: '2026-02-12',
        amount: '10',
        mirror: true,
        note: pool === 'A' ? 'Nota Liquidez Alfa' : 'Nota Liquidez Beta',
      },
    );
  });

/** A cash move of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignCashMove = async (s: Scenario): Promise<Foreign> => {
  const other = await cashMoveIn(s, 'B');
  return {
    params: { id: other.portfolioId, moveId: other.id },
    unchanged: async () => {
      const seen = await s.world.cashMoves.list(await s.as('outsider'), s.poolB, other.portfolioId);
      expect(seen.moves).toContainEqual(other);
    },
  };
};

/** A plan in pool A or pool B, made once per scenario. */
const planIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`plan-${pool}`, async () =>
    s.world.plans.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        portfolioId: (await portfolioIn(s, pool)).id,
        assetId: (await assetIn(s, pool)).id,
        amount: pool === 'A' ? '100' : '250',
        day: 5,
      },
    ),
  );

/** The plan of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignPlan = async (s: Scenario): Promise<Foreign> => {
  const other = await planIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.plans.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A goal in pool A or pool B, made once per scenario. */
const goalIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`goal-${pool}`, async () =>
    s.world.goals.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        name: pool === 'A' ? 'Objetivo Alfa' : 'Objetivo Beta Secreto',
        color: '#9D6BFF',
        type: 'value',
        target: pool === 'A' ? '10000' : '25000',
        deadline: '2060-01-01',
      },
    ),
  );

/** The goal of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignGoal = async (s: Scenario): Promise<Foreign> => {
  const other = await goalIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.goals.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A savings product in pool A or pool B, made once per scenario. */
const productIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`product-${pool}`, async () =>
    s.world.products.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { name: 'Produto Alfa Secreto', rate: '2.5', payN: 3, payU: 'm', termN: 12, termU: 'm' }
        : { name: 'Produto Beta Secreto', rate: '3.1', payN: 1, payU: 'm' },
    ),
  );

/** The product of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignProduct = async (s: Scenario): Promise<Foreign> => {
  const other = await productIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.products.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A term-deposit account (the `n`th one) or a savings account in pool A or B, made once. */
const cashAccountIn = (s: Scenario, pool: 'A' | 'B', type: string, n = 1) =>
  s.memo(`${type}-${pool}-${n}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [holder] = (await s.world.holders.list(headers, poolId)).holders;
    return s.world.accounts.create(headers, poolId, {
      type,
      name: `${type} ${pool}${n}`,
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
  });

/** The deposit of a term-deposit account in pool A or B, made once per scenario. */
const depositIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`deposit-${pool}`, async () =>
    s.world.deposits.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        accountId: (await cashAccountIn(s, pool, 'term_deposit')).id,
        productId: (await productIn(s, pool)).id,
        capital: pool === 'A' ? '10000' : '25000',
        start: '2026-01-31',
      },
    ),
  );

/** The deposit of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignDeposit = async (s: Scenario): Promise<Foreign> => {
  const other = await depositIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.deposits.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** An interest entry on the savings account of pool A or B, made once per scenario. */
const interestIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`interest-${pool}`, async () =>
    s.world.interest.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      {
        accountId: (await cashAccountIn(s, pool, 'savings')).id,
        date: '2026-02-01',
        amount: pool === 'A' ? '12.34' : '56.78',
        note: pool === 'A' ? 'Nota Alfa Secreta' : 'Nota Beta Secreta',
      },
    ),
  );

/** The entry of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignInterest = async (s: Scenario): Promise<Foreign> => {
  const other = await interestIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.interest.list(await s.as('outsider'), s.poolB);
      expect(seen.entries.find((entry) => entry.id === other.id)).toEqual(other);
    },
  };
};

/** A note on the month 2026-03 of pool B, made once per scenario. */
const monthNoteB = (s: Scenario) =>
  s.memo('month-note-B', async () =>
    s.world.notes.putMonthNote(await s.as('outsider'), s.poolB, '2026-03', {
      body: 'Nota do mês Beta Secreta',
      expectedUpdatedAt: null,
    }),
  );

export const ROUTE_REGISTRY: readonly RouteSpec[] = [
  // ---------------------------------------------------------------- pool scope: members
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/members`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/route')),
    success: { status: 200, schema: MemberListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s people',
    leaks: (s) =>
      Promise.resolve([s.ids.outsider, s.ids.bMember, s.emails.outsider, s.emails.bMember]),
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/members/:userId`,
    permission: 'members.manage',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/[userId]/route')),
    params: (s) => Promise.resolve({ userId: s.ids.member }),
    body: () => ({ role: 'viewer' }),
    success: {
      status: 200,
      schema: MemberRoleDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'member')).toBe('viewer');
      },
    },
    foreign: foreignMember,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/members/:userId`,
    permission: 'members.manage',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/[userId]/route')),
    params: (s) => Promise.resolve({ userId: s.ids.viewer }),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'viewer')).toBeUndefined();
      },
    },
    foreign: foreignMember,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/leave`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/leave/route')),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'viewer')).toBeUndefined();
      },
    },
    noForeignBecause: 'takes no id; leaving a pool you are not in is the non-member 404 case',
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/transfer`,
    permission: 'pool.transfer',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transfer/route')),
    body: (s) => ({ userId: s.ids.member, password: PASSWORD }),
    success: {
      status: 200,
      schema: TransferOwnershipDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'member')).toBe('owner');
        expect(await s.roleOf(s.poolA, 'owner')).toBe('admin');
      },
    },
    foreign: (s) =>
      Promise.resolve({
        body: { userId: s.ids.bMember, password: PASSWORD },
        unchanged: async () => {
          expect(await s.roleOf(s.poolB, 'bMember')).toBe('member');
          expect(await s.roleOf(s.poolA, 'owner')).toBe('owner');
        },
      }),
  },

  // ---------------------------------------------------------------- pool scope: assets
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/route')),
    success: { status: 200, schema: AssetListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s assets',
    leaks: async (s) => {
      await assetIn(s, 'A');
      const other = await assetIn(s, 'B');
      return [other.id, other.ticker, other.name];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/assets`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/route')),
    body: () => ({ ticker: 'nova', name: 'Nova', type: 'etf', currency: 'EUR', divMonths: [3, 9] }),
    success: { status: 201, schema: AssetDto },
    noForeignBecause: 'creates a new row; the ticker is checked inside the URL’s own pool',
    negatives: [
      {
        name: 'a ticker with a space',
        body: { ticker: 'A B', name: 'x', type: 'etf', currency: 'EUR' },
        expect: 400,
      },
      {
        name: 'an unknown type',
        body: { ticker: 'X', name: 'x', type: 'nft', currency: 'EUR' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 200, schema: AssetDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/assets/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    body: () => ({ name: 'Alfa Omega', dps: '1.5' }),
    success: { status: 200, schema: AssetDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/assets/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets/:id/prices`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 200, schema: PriceHistoryDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/assets/:id/prices`,
    permission: 'prices.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    body: () => ({ date: '2026-01-02', price: '101.25' }),
    success: { status: 200, schema: PriceDto },
    foreign: foreignAsset,
    negatives: [{ name: 'a price of zero', body: { date: '2026-01-02', price: '0' }, expect: 400 }],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/assets/:id/prices/:date`,
    permission: 'prices.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/[date]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id, date: '2026-01-02' }),
    prepare: async (s) => {
      const asset = await assetIn(s, 'A');
      await s.world.assets.setPrice(await s.as('owner'), s.poolA, asset.id, {
        date: '2026-01-02',
        price: '10',
      });
    },
    success: { status: 204 },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/asset-prices`,
    permission: 'prices.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/asset-prices/route')),
    prepare: async (s) => {
      await assetIn(s, 'A');
    },
    body: () => ({ prices: [{ ticker: 'alfafund', date: '2026-01-02', price: '10.5' }] }),
    success: { status: 200, schema: BulkPricesDto },
    noForeignBecause:
      'tickers are looked up inside the URL’s own pool; pool B’s ticker is a negative case',
    negatives: [
      {
        name: 'a ticker that only exists in pool B',
        body: { prices: [{ ticker: 'BETACORP', date: '2026-01-02', price: '1' }] },
        expect: 400,
      },
    ],
  },

  // ---------------------------------------------------------------- pool scope: categories
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/categories`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/route')),
    success: { status: 200, schema: CategoryListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s categories',
    leaks: async (s) => {
      await categoryIn(s, 'A');
      const other = await categoryIn(s, 'B');
      await s.world.categories.updateSettings(await s.as('outsider'), s.poolB, other.id, {
        monthlyBudget: '777.77',
      });
      return [other.id, other.name ?? '', '777.77'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/categories`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/route')),
    body: () => ({ name: 'Nova categoria', kind: 'income', color: '#112233' }),
    success: { status: 201, schema: CategoryDto },
    noForeignBecause: 'creates a new row in the URL’s own pool; the pool never comes from the body',
    negatives: [
      {
        name: 'a system key',
        body: { name: 'x', kind: 'expense', systemKey: 'groceries' },
        expect: 400,
      },
      { name: 'an unknown kind', body: { name: 'x', kind: 'gift' }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/categories/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    body: () => ({ name: 'Categoria Omega' }),
    success: { status: 200, schema: CategoryDto },
    foreign: foreignCategory,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/categories/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignCategory,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/categories/:id/settings`,
    permission: 'categories.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/settings/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    body: () => ({ monthlyBudget: '150', hidden: true, colorOverride: '#AABBCC' }),
    success: { status: 200, schema: CategoryDto },
    foreign: foreignCategory,
  },

  // ---------------------------------------------------------------- pool scope: expenses
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/expenses/summary`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/expenses/summary/route')),
    success: { status: 200, schema: ExpensesSummaryDto },
    noForeignBecause: 'summarizes the URL’s own pool; the leak probe covers pool B’s movements',
    leaks: async (s) => {
      await transactionIn(s, 'A');
      const other = await transactionIn(s, 'B');
      return [other.id, other.description];
    },
    negatives: [
      { name: 'a month that is not yyyy-mm', query: '?month=2026-13', expect: 400 },
      { name: 'an unknown filter', query: '?poolId=2', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/expenses/totals`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/expenses/totals/route')),
    success: { status: 200, schema: MovementTotalsDto },
    noForeignBecause: 'totals of the URL’s own pool; the leak probe covers pool B’s movements',
    leaks: async (s) => {
      await transactionIn(s, 'A');
      const other = await transactionIn(s, 'B');
      return [other.id, other.description];
    },
    negatives: [
      { name: 'an unknown filter', query: '?accountId=1&poolId=2', expect: 400 },
      { name: 'a sort (not a filter of the totals)', query: '?sort=amount', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/expenses/usage`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/expenses/usage/route')),
    success: { status: 200, schema: ExpensesUsageDto },
    noForeignBecause: 'counts the URL’s own pool; the leak probe covers pool B’s ids',
    leaks: async (s) => {
      await transactionIn(s, 'A');
      const other = await transactionIn(s, 'B');
      return [other.id, other.accountId];
    },
  },
  // ---------------------------------------------------------------- pool scope: transactions
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/transactions`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transactions/route')),
    success: { status: 200, schema: TransactionPageDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s movements',
    leaks: async (s) => {
      await transactionIn(s, 'A');
      const other = await transactionIn(s, 'B');
      return [other.id, other.description];
    },
    negatives: [
      { name: 'a sort outside the allow-list', query: '?sort=amount;drop table', expect: 400 },
      { name: 'an unknown filter', query: '?accountId=1&poolId=2', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/transactions`,
    permission: 'transactions.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transactions/route')),
    body: async (s) => ({
      accountId: (await txAccountIn(s, 'A')).id,
      date: '2026-03-11',
      description: 'COMPRA REPSOL LISBOA',
      amount: '-40',
    }),
    success: { status: 201, schema: TransactionDto },
    noForeignBecause: 'creates a new row; an account of another pool is a negative case',
    negatives: [
      {
        name: 'an account of another pool',
        body: {
          accountId: '0192f3a1-0000-7000-8000-000000000001',
          date: '2026-03-11',
          description: 'x',
          amount: '-1',
        },
        expect: 400,
      },
      {
        name: 'an amount of zero',
        body: {
          accountId: '0192f3a1-0000-7000-8000-000000000001',
          date: '2026-03-11',
          description: 'x',
          amount: '0',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/transactions/:id`,
    permission: 'transactions.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transactions/[id]/route')),
    params: async (s) => ({ id: (await transactionIn(s, 'A')).id }),
    body: () => ({ transfer: true }),
    success: { status: 200, schema: TransactionDto },
    foreign: foreignTransaction,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/transactions/:id`,
    permission: 'transactions.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transactions/[id]/route')),
    params: async (s) => ({ id: (await transactionIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignTransaction,
  },

  // ---------------------------------------------------------------- pool scope: rules
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/rules`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/route')),
    success: { status: 200, schema: RuleListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s rules',
    leaks: async (s) => {
      await ruleIn(s, 'A');
      const other = await ruleIn(s, 'B');
      return [other.id, other.keyword];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/rules`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/route')),
    body: async (s) => ({
      keyword: 'CONTINENTE',
      categoryId: (await s.world.categories.list(await s.as('owner'), s.poolA)).categories[0]?.id,
    }),
    success: { status: 201, schema: RuleDto },
    noForeignBecause: 'creates a new row; a category or account of another pool is a negative case',
    negatives: [
      {
        name: 'a category of another pool',
        body: { keyword: 'XX', categoryId: '0192f3a1-0000-7000-8000-000000000001' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/rules/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/[id]/route')),
    params: async (s) => ({ id: (await ruleIn(s, 'A')).id }),
    body: () => ({ keyword: 'GALP' }),
    success: { status: 200, schema: RuleDto },
    foreign: foreignRule,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/rules/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/[id]/route')),
    params: async (s) => ({ id: (await ruleIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignRule,
  },
  {
    scope: 'pool',
    method: 'PUT',
    path: `${POOL}/rules/order`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/order/route')),
    body: async (s) => ({ ids: [(await ruleIn(s, 'A')).id] }),
    success: { status: 200, schema: RuleListDto },
    noForeignBecause:
      'the ids are checked against the URL’s own pool; pool B’s rule is a negative case',
    negatives: [
      {
        name: 'a rule of another pool',
        body: { ids: ['0192f3a1-0000-7000-8000-000000000001'] },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/rules/apply`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/rules/apply/route')),
    body: () => ({ confirm: false }),
    success: { status: 200, schema: ApplyRulesDto },
    noForeignBecause: 'works on the URL’s own pool; there is no id in the path',
  },

  // ---------------------------------------------------------------- pool scope: prototype import
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/import-prototype`,
    permission: 'pool.import',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/import-prototype/route')),
    // A dry run, so the case can repeat in the same pool; the service tests cover the commit.
    body: () => ({ dryRun: true, export: { v: 6 } }),
    success: { status: 200, schema: ImportResultDto },
    noForeignBecause: 'works on the URL’s own pool; there is no id in the path',
    negatives: [
      {
        name: 'an export with an unknown field',
        body: { dryRun: true, export: { surprise: 1 } },
        expect: 400,
      },
      { name: 'a body that is not an object', body: 'nope', expect: 400 },
    ],
  },

  // ---------------------------------------------------------------- pool scope: statement import
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/imports`,
    permission: 'imports.run',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/route')),
    success: { status: 200, schema: ImportHistoryDto },
    noForeignBecause:
      'lists the URL’s own pool; RLS and the pool filter are checked by the history test in tests/services/imports.integration.test.ts',
    negatives: [
      { name: 'an unknown query field', query: '?poolId=1', expect: 400 },
      { name: 'an account that is not a uuid', query: "?accountId=' OR 1=1 --", expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/imports/:batchId`,
    permission: 'imports.run',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/[batchId]/route')),
    params: async (s) => ({ batchId: (await importIn(s, 'A')).batchId }),
    success: { status: 200, schema: ImportPreviewDto },
    foreign: foreignImport,
    negatives: [
      { name: 'an unknown query field', query: '?poolId=1', expect: 400 },
      { name: 'an account that is not a uuid', query: '?accountId=1', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/imports/:batchId`,
    permission: 'imports.run',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/[batchId]/route')),
    params: async (s) => ({ batchId: (await importIn(s, 'A')).batchId }),
    success: { status: 204 },
    foreign: foreignImport,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/imports/:batchId/commit`,
    permission: 'imports.run',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/[batchId]/commit/route')),
    params: async (s) => ({ batchId: (await importIn(s, 'A')).batchId }),
    body: async (s) => ({ accountId: (await importTarget(s)).id }),
    success: { status: 200, schema: CommitImportResultDto },
    foreign: foreignImport,
    negatives: [
      { name: 'no account', body: {}, expect: 400 },
      {
        name: 'a status chosen by the client',
        body: { accountId: '0192f3a1-0000-7000-8000-000000000001', status: 'committed' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'exempt',
    method: 'POST',
    path: `${POOL}/imports`,
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/route')),
    reason:
      'multipart/form-data, which the generated cases (JSON bodies) cannot send; tests/web/imports-route.integration.test.ts runs the same checks against the real handler: 401, 404 for non-members, 403 below imports.run, 413 over 10 MB, 415 for a renamed executable, unknown fields, Origin and the strict success body',
  },

  // ---------------------------------------------------------------- pool scope: accounts
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/accounts`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/route')),
    success: { status: 200, schema: AccountListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s accounts',
    leaks: async (s) => {
      await accountIn(s, 'A');
      const other = await accountIn(s, 'B');
      const sub = await subAccountIn(s, 'B');
      return [other.id, other.name, sub.id, sub.name];
    },
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/accounts/overview`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/overview/route')),
    success: { status: 200, schema: AccountsScreenDto },
    noForeignBecause: 'reads the URL’s own pool; the leak probe covers pool B’s accounts',
    leaks: async (s) => {
      await accountIn(s, 'A');
      const other = await accountIn(s, 'B');
      return [other.id, other.name];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/accounts`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/route')),
    body: async (s) => ({
      type: 'checking',
      name: 'Conta nova',
      currency: 'EUR',
      iban: 'PT50 0002 0123 1234 5678 9015 4',
      holderIds: [(await s.world.holders.list(await s.as('owner'), s.poolA)).holders[0]?.id],
    }),
    success: { status: 201, schema: AccountDto },
    noForeignBecause: 'creates a new row; a holder of another pool is a negative case',
    negatives: [
      {
        name: 'names a person of another pool',
        body: {
          type: 'checking',
          name: 'X',
          currency: 'EUR',
          holderIds: ['00000000-0000-7000-8000-000000000001'],
        },
        expect: 400,
      },
      {
        name: 'an IBAN with a wrong check digit',
        body: {
          type: 'checking',
          name: 'X',
          currency: 'EUR',
          iban: 'PT50000201231234567890155',
          holderIds: ['00000000-0000-7000-8000-000000000001'],
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/accounts/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    success: { status: 200, schema: AccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/accounts/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    body: () => ({ name: 'Conta Omega', openingDate: '2026-01-01', opening: '10.5' }),
    success: { status: 200, schema: AccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/accounts/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/accounts/:id/sub-accounts`,
    permission: 'accounts.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    body: () => ({ name: 'Sub nova' }),
    success: { status: 201, schema: SubAccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/accounts/:id/sub-accounts/:subId`,
    permission: 'accounts.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/[subId]/route'),
      ),
    params: async (s) => {
      const sub = await subAccountIn(s, 'A');
      return { id: sub.accountId, subId: sub.id };
    },
    body: () => ({ name: 'Sub Omega' }),
    success: { status: 200, schema: SubAccountDto },
    foreign: foreignSubAccount,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/accounts/:id/sub-accounts/:subId`,
    permission: 'accounts.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/[subId]/route'),
      ),
    params: async (s) => {
      const sub = await subAccountIn(s, 'A');
      return { id: sub.accountId, subId: sub.id };
    },
    success: { status: 204 },
    foreign: foreignSubAccount,
  },

  // ---------------------------------------------------------------- pool scope: holders
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/holders`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/route')),
    success: { status: 200, schema: HolderListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s people',
    leaks: async (s) => {
      await holderIn(s, 'A');
      const other = await holderIn(s, 'B');
      return [other.id, other.name, ...other.aliases];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/holders`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/route')),
    body: () => ({ name: 'Carla', aliases: ['carla gama'] }),
    success: { status: 201, schema: HolderDto },
    noForeignBecause: 'creates a new row; linking to a user of another pool is a negative case',
    negatives: [
      {
        name: 'links a user who is not a member of the pool',
        body: { name: 'Carla', userId: '00000000-0000-7000-8000-000000000001' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/holders/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    body: () => ({ name: 'Ana Omega' }),
    success: { status: 200, schema: HolderDto },
    foreign: foreignHolder,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/holders/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignHolder,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/holders/:id/merge`,
    permission: 'accounts.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/merge/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    query: async (s) => `?intoId=${(await memberHolderOf(s)).id}`,
    success: { status: 200, schema: MergePreviewDto },
    foreign: foreignHolder,
    negatives: [
      {
        name: 'a target that is not in the pool',
        query: '?intoId=00000000-0000-7000-8000-000000000001',
        expect: 404,
      },
      { name: 'no target', query: '', expect: 400 },
      { name: 'an extra query field', query: '?intoId=x&poolId=y', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/holders/:id/merge`,
    permission: 'accounts.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/merge/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    body: async (s) => ({ intoId: (await memberHolderOf(s)).id }),
    success: {
      status: 200,
      schema: HolderDto,
      check: async (s, body) => {
        expect(HolderDto.parse(body).aliases).toContain('ANA ALFA');
        const seen = (await s.world.holders.list(await s.as('owner'), s.poolA)).holders;
        expect(seen.some((holder) => holder.name === 'Ana Alfa')).toBe(false);
      },
    },
    foreign: foreignHolder,
    negatives: [
      {
        name: 'a target that is not in the pool',
        body: { intoId: '00000000-0000-7000-8000-000000000001' },
        expect: 404,
      },
    ],
  },

  // ---------------------------------------------------------------- pool scope: rename (NES-137)
  {
    scope: 'pool',
    method: 'PATCH',
    path: POOL,
    permission: 'pool.rename',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/route')),
    body: () => ({ name: 'Família Renomeada' }),
    success: { status: 200, schema: PoolSummaryDto },
    noForeignBecause: 'the pool is the URL’s own; there is no other id in the path',
    negatives: [
      { name: 'an empty name', body: { name: '' }, expect: 400 },
      { name: 'a name of 61 characters', body: { name: 'x'.repeat(61) }, expect: 400 },
      {
        name: 'an id in the body',
        body: { name: 'Casa', id: '00000000-0000-7000-8000-000000000001' },
        expect: 400,
      },
      {
        name: 'a creation date in the body',
        body: { name: 'Casa', createdAt: '2020-01-01T00:00:00Z' },
        expect: 400,
      },
    ],
  },

  // ---------------------------------------------------------------- pool scope: settings
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/settings`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/settings/route')),
    success: { status: 200, schema: SettingsDto },
    noForeignBecause: 'reads the URL’s own pool; there is no id in the path',
    leaks: async (s) => {
      await s.world.settings.update(await s.as('outsider'), s.poolB, {
        fxOverrides: { USD: '0.8123' },
      });
      return ['0.8123'];
    },
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/settings`,
    permission: 'settings.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/settings/route')),
    body: () => ({ depositTax: '25', transferWindowDays: 5 }),
    success: { status: 200, schema: SettingsDto },
    noForeignBecause: 'one row per pool, chosen by the URL’s pool; no id in the path',
    negatives: [
      { name: 'a negative tax', body: { depositTax: '-1' }, expect: 400 },
      { name: 'a rate for EUR', body: { fxOverrides: { EUR: '1' } }, expect: 400 },
      { name: 'a window beyond 30 days', body: { transferWindowDays: 31 }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/fx`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/fx/route')),
    success: { status: 200, schema: FxDto },
    noForeignBecause: 'reads the URL’s own pool; the leak probe covers pool B’s overrides',
    leaks: async (s) => {
      await s.world.settings.update(await s.as('outsider'), s.poolB, {
        fxOverrides: { USD: '0.7771' },
      });
      return ['0.7771'];
    },
  },

  // ---------------------------------------------------------------- pool scope: invites
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/invites`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/route')),
    success: { status: 200, schema: InviteListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s invites',
    leaks: async (s) => {
      await pendingInvite(s, 'A');
      const other = await pendingInvite(s, 'B');
      return [other.id, other.email];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/invites`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/route')),
    body: () => ({ email: 'new-person@example.test', role: 'viewer' }),
    success: { status: 201, schema: InviteDto },
    noForeignBecause: 'creates in the URL’s own pool; no id of another pool is accepted',
    negatives: [
      {
        name: 'an admin cannot invite an owner',
        as: 'admin',
        body: { email: 'boss@example.test', role: 'owner' },
        expect: 403,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/invites/:id`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/route')),
    params: async (s) => ({ id: (await pendingInvite(s, 'A')).id }),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.inviteRow((await pendingInvite(s, 'A')).id)).toBeUndefined();
      },
    },
    foreign: async (s) => {
      const other = await pendingInvite(s, 'B');
      const before = await s.inviteRow(other.id);
      return {
        params: { id: other.id },
        unchanged: async () => {
          expect(await s.inviteRow(other.id)).toEqual(before);
        },
      };
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/invites/:id/resend`,
    permission: 'members.invite',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/resend/route')),
    params: async (s) => ({ id: (await pendingInvite(s, 'A')).id }),
    success: { status: 200, schema: InviteDto },
    foreign: async (s) => {
      const other = await pendingInvite(s, 'B');
      const before = await s.inviteRow(other.id);
      const mails = s.world.mail.sent.length;
      return {
        params: { id: other.id },
        unchanged: async () => {
          expect(await s.inviteRow(other.id)).toEqual(before);
          expect(s.world.mail.sent).toHaveLength(mails);
        },
      };
    },
  },

  // ---------------------------------------------------------------- user scope
  {
    scope: 'user',
    method: 'POST',
    path: '/api/v1/pools',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/route')),
    body: () => ({ name: 'Another household' }),
    success: {
      status: 201,
      schema: PoolSummaryDto,
      check: async (s, body) => {
        const { id } = body as { id: string };
        expect(await s.roleOf(id, 'owner')).toBe('owner');
      },
    },
    noForeignBecause: 'there is no id in the request; the owner is the session user, never a field',
  },
  {
    scope: 'user',
    method: 'GET',
    path: '/api/v1/me',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/route')),
    success: { status: 200, schema: MeWithPoolsDto },
    noForeignBecause: 'always the session user’s own profile; the leak probe covers other users',
    leaks: (s) => Promise.resolve([s.ids.admin, s.emails.admin, s.ids.outsider, s.emails.outsider]),
  },
  {
    scope: 'user',
    method: 'PATCH',
    path: '/api/v1/me',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/route')),
    body: () => ({ name: 'Rui Rocha' }),
    success: { status: 200, schema: MeDto },
    noForeignBecause:
      'always the session user’s own profile; `id` or `email` in the body answer 400',
  },
  {
    scope: 'user',
    method: 'GET',
    path: '/api/v1/me/sessions',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/route')),
    success: { status: 200, schema: SessionListDto },
    noForeignBecause: 'lists the session user’s own sessions; the leak probe covers other users',
    leaks: async (s) => [...(await s.sessionIds('admin')), ...(await s.sessionIds('outsider'))],
  },
  {
    scope: 'user',
    method: 'DELETE',
    path: '/api/v1/me/sessions',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/route')),
    query: '?others=true',
    prepare: async (s) => {
      await ownerExtraSession(s);
    },
    success: {
      status: 200,
      schema: RevokedSessionsDto,
      check: async (s, body) => {
        expect((body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
        expect(await s.sessionIds('admin')).not.toHaveLength(0);
        expect(await s.sessionIds('outsider')).not.toHaveLength(0);
      },
    },
    noForeignBecause:
      'ends only the session user’s other sessions; nothing in the request names one',
    negatives: [{ name: 'a bare DELETE never means “end everything”', query: '', expect: 400 }],
  },
  {
    scope: 'user',
    method: 'DELETE',
    path: '/api/v1/me/sessions/:id',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/[id]/route')),
    params: async (s) => ({
      id: (await ownerExtraSession(s)).id,
    }),
    success: {
      status: 204,
      check: async (s) => {
        const { id } = await ownerExtraSession(s);
        expect(await s.sessionIds('owner')).not.toContain(id);
      },
    },
    foreign: async (s) => {
      const [theirs] = await s.sessionIds('admin');
      return {
        params: { id: theirs ?? '' },
        unchanged: async () => {
          expect(await s.sessionIds('admin')).toContain(theirs);
        },
      };
    },
  },
  {
    scope: 'user',
    method: 'POST',
    path: '/api/v1/invites/:token/accept',
    caller: 'newcomer',
    load: () => load(import('../../apps/web/src/app/api/v1/invites/[token]/accept/route')),
    params: async (s) => ({
      token: (await s.memo('invite-for-newcomer', () => s.invite('B', s.emails.newcomer))).token,
    }),
    success: {
      status: 200,
      schema: AcceptInviteDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolB, 'newcomer')).toBe('viewer');
      },
    },
    foreign: async (s) => {
      const elsewhere = await s.invite('B');
      const before = await s.inviteRow(elsewhere.id);
      return {
        params: { token: elsewhere.token },
        unchanged: async () => {
          expect(await s.inviteRow(elsewhere.id)).toEqual(before);
          expect(await s.roleOf(s.poolB, 'newcomer')).toBeUndefined();
        },
      };
    },
  },

  // ---------------------------------------------------------------- pool scope: portfolios, operations, plans
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/portfolios`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/route')),
    success: { status: 200, schema: PortfolioListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s portfolios',
    leaks: async (s) => {
      await portfolioIn(s, 'A');
      const other = await portfolioIn(s, 'B');
      return [other.id, other.name];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/portfolios`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/route')),
    body: () => ({ name: 'Reforma', color: '#778899', currency: 'EUR', targets: { etf: '60' } }),
    success: { status: 201, schema: PortfolioDto },
    noForeignBecause: 'creates a new row; the pool comes from the URL',
    negatives: [
      {
        name: 'targets above 100 %',
        body: { name: 'X', color: '#778899', currency: 'EUR', targets: { etf: '101' } },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/overview`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/overview/route')),
    success: { status: 200, schema: OverviewDto },
    noForeignBecause: 'summarizes the URL’s own pool; the leak probe covers pool B’s operations',
    leaks: async (s) => {
      await opIn(s, 'A');
      const other = await opIn(s, 'B');
      return [other.id, other.portfolioId, other.assetId];
    },
    negatives: [
      { name: 'an unknown filter', query: '?poolId=1', expect: 400 },
      { name: 'a range that does not exist', query: '?range=7', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/portfolios/summary`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/summary/route')),
    success: { status: 200, schema: PortfolioSummaryDto },
    noForeignBecause: 'summarizes the URL’s own pool; the leak probe covers pool B’s operations',
    leaks: async (s) => {
      await opIn(s, 'A');
      const other = await opIn(s, 'B');
      return [other.id, other.portfolioId, other.assetId];
    },
    negatives: [{ name: 'an unknown filter', query: '?poolId=1', expect: 400 }],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/portfolios/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/route')),
    params: async (s) => ({ id: (await portfolioIn(s, 'A')).id }),
    success: { status: 200, schema: PortfolioDto },
    foreign: foreignPortfolio,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/portfolios/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/route')),
    params: async (s) => ({ id: (await portfolioIn(s, 'A')).id }),
    body: () => ({ note: 'Para a reforma' }),
    success: { status: 200, schema: PortfolioDto },
    foreign: foreignPortfolio,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/portfolios/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/route')),
    params: async (s) => ({ id: (await portfolioIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignPortfolio,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/ops`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/route')),
    success: { status: 200, schema: OpListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s operations',
    leaks: async (s) => {
      await opIn(s, 'A');
      const other = await opIn(s, 'B');
      return [other.id, other.note ?? ''];
    },
    negatives: [{ name: 'an unknown filter', query: '?type=buy&poolId=2', expect: 400 }],
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/ops`,
    permission: 'ops.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/route')),
    body: async (s) => ({
      portfolioId: (await portfolioIn(s, 'A')).id,
      assetId: (await assetIn(s, 'A')).id,
      type: 'buy',
      date: '2026-03-02',
      qty: '2',
      price: '15.5',
    }),
    success: { status: 201, schema: OpDto },
    noForeignBecause: 'creates a new row; a portfolio or asset of another pool is a negative case',
    negatives: [
      {
        name: 'a portfolio of another pool',
        body: {
          portfolioId: '0192f3a1-0000-7000-8000-000000000001',
          assetId: '0192f3a1-0000-7000-8000-000000000002',
          type: 'buy',
          date: '2026-03-02',
          qty: '1',
          price: '1',
        },
        expect: 400,
      },
      {
        name: 'a buy without quantity',
        body: {
          portfolioId: '0192f3a1-0000-7000-8000-000000000001',
          assetId: '0192f3a1-0000-7000-8000-000000000002',
          type: 'buy',
          date: '2026-03-02',
          price: '1',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/ops/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/[id]/route')),
    params: async (s) => ({ id: (await opIn(s, 'A')).id }),
    success: { status: 200, schema: OpDto },
    foreign: foreignOp,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/ops/:id`,
    permission: 'ops.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/[id]/route')),
    params: async (s) => ({ id: (await opIn(s, 'A')).id }),
    body: () => ({ qty: '4' }),
    success: { status: 200, schema: OpDto },
    foreign: foreignOp,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/ops/:id`,
    permission: 'ops.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/[id]/route')),
    params: async (s) => ({ id: (await opIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignOp,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/portfolios/:id/cash-moves`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/cash-moves/route')),
    params: async (s) => ({ id: (await portfolioIn(s, 'A')).id }),
    success: { status: 200, schema: CashMoveListDto },
    foreign: foreignPortfolio,
    leaks: async (s) => {
      await cashMoveIn(s, 'A');
      const other = await cashMoveIn(s, 'B');
      return [other.id, other.note ?? ''];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/portfolios/:id/cash-moves`,
    permission: 'ops.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/cash-moves/route')),
    params: async (s) => ({ id: (await portfolioIn(s, 'A')).id }),
    prepare: async (s) => {
      await cashIn(s, 'A');
    },
    body: async (s) => ({
      accountId: (await cashAccountIn(s, 'A', 'checking')).id,
      date: '2026-03-02',
      amount: '25.5',
      mirror: false,
    }),
    success: { status: 201, schema: CashMoveDto },
    foreign: foreignPortfolio,
    negatives: [
      {
        name: 'more than the cash available',
        body: {
          accountId: '0192f3a1-0000-7000-8000-000000000001',
          date: '2026-03-02',
          amount: '1',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/portfolios/:id/cash-moves/:moveId`,
    permission: 'ops.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/portfolios/[id]/cash-moves/[moveId]/route'),
      ),
    params: async (s) => ({
      id: (await portfolioIn(s, 'A')).id,
      moveId: (await cashMoveIn(s, 'A')).id,
    }),
    success: { status: 204 },
    foreign: foreignCashMove,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/plans`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/route')),
    success: { status: 200, schema: PlanListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s plans',
    leaks: async (s) => {
      await planIn(s, 'A');
      const other = await planIn(s, 'B');
      return [other.id, other.assetId];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/plans`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/route')),
    body: async (s) => ({
      portfolioId: (await portfolioIn(s, 'A')).id,
      assetId: (await assetIn(s, 'A')).id,
      amount: '75',
      day: 10,
    }),
    success: { status: 201, schema: PlanDto },
    noForeignBecause: 'creates a new row; a portfolio or asset of another pool is a negative case',
    negatives: [
      {
        name: 'a day outside 1-28',
        body: {
          portfolioId: '0192f3a1-0000-7000-8000-000000000001',
          assetId: '0192f3a1-0000-7000-8000-000000000002',
          amount: '75',
          day: 31,
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/plans/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/[id]/route')),
    params: async (s) => ({ id: (await planIn(s, 'A')).id }),
    success: { status: 200, schema: PlanDto },
    foreign: foreignPlan,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/plans/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/[id]/route')),
    params: async (s) => ({ id: (await planIn(s, 'A')).id }),
    body: () => ({ active: false }),
    success: { status: 200, schema: PlanDto },
    foreign: foreignPlan,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/plans/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/[id]/route')),
    params: async (s) => ({ id: (await planIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignPlan,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/plans/:id/run`,
    permission: 'ops.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plans/[id]/run/route')),
    params: async (s) => ({ id: (await planIn(s, 'A')).id }),
    body: () => ({ month: '2026-03' }),
    prepare: async (s) => {
      await s.world.assets.setPrice(await s.as('owner'), s.poolA, (await assetIn(s, 'A')).id, {
        date: '2026-03-01',
        price: '20',
      });
    },
    success: { status: 201, schema: PlanRunDto },
    foreign: foreignPlan,
  },

  // ---------------------------------------------------------------- pool scope: plan
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/plan`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/plan/route')),
    success: { status: 200, schema: PoolPlanDto },
    noForeignBecause: 'reports the URL’s own pool; the leak probe covers pool B’s accounts',
    leaks: async (s) => {
      await accountIn(s, 'A');
      const other = await accountIn(s, 'B');
      return [other.id, other.name];
    },
  },
  // ---------------------------------------------------------------- pool scope: goals
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/goals`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/goals/route')),
    success: { status: 200, schema: GoalListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s goals',
    leaks: async (s) => {
      await goalIn(s, 'A');
      const other = await goalIn(s, 'B');
      return [other.id, 'Objetivo Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/goals`,
    permission: 'goals.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/goals/route')),
    body: () => ({
      name: 'Novo objetivo',
      color: '#2BC6B4',
      type: 'invested',
      target: '30000',
      mode: 'eta',
    }),
    success: { status: 201, schema: GoalDto },
    noForeignBecause:
      'creates a new row; a portfolio or account of another pool is a negative case',
    negatives: [
      {
        name: 'a target of zero',
        body: { name: 'Mau', color: '#2BC6B4', type: 'value', target: '0', deadline: '2060-01-01' },
        expect: 400,
      },
      {
        name: 'a date goal without a deadline',
        body: { name: 'Mau', color: '#2BC6B4', type: 'value', target: '100' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/goals/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/goals/[id]/route')),
    params: async (s) => ({ id: (await goalIn(s, 'A')).id }),
    success: { status: 200, schema: GoalDto },
    foreign: foreignGoal,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/goals/:id`,
    permission: 'goals.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/goals/[id]/route')),
    params: async (s) => ({ id: (await goalIn(s, 'A')).id }),
    body: () => ({ name: 'Renomeado' }),
    success: { status: 200, schema: GoalDto },
    foreign: foreignGoal,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/goals/:id`,
    permission: 'goals.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/goals/[id]/route')),
    params: async (s) => ({ id: (await goalIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignGoal,
  },

  // ---------------------------------------------------------------- pool scope: real estate
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/properties`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/route')),
    success: { status: 200, schema: PropertyListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s properties',
    leaks: async (s) => {
      await propertyIn(s, 'A');
      const other = await propertyIn(s, 'B');
      return [other.id, 'Apartamento Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/properties`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/route')),
    body: async (s) => {
      const [holder] = (await s.world.holders.list(await s.as('owner'), s.poolA)).holders;
      return {
        name: 'Garagem',
        type: 'garage',
        purchaseDate: '2021-05-10',
        purchasePrice: '15000',
        holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
      };
    },
    success: { status: 201, schema: PropertyDto },
    noForeignBecause: 'creates a new row; a person of another pool is a negative case',
    negatives: [
      {
        name: 'shares that do not add up to 100',
        body: {
          name: 'Mau',
          type: 'land',
          purchaseDate: '2021-05-10',
          purchasePrice: '15000',
          holders: [{ holderId: '0192f2c8-7a1e-7000-8000-000000000001', sharePct: '60' }],
        },
        expect: 400,
      },
      {
        name: 'a person that is not in this pool',
        body: {
          name: 'Mau',
          type: 'land',
          purchaseDate: '2021-05-10',
          purchasePrice: '15000',
          holders: [{ holderId: '0192f2c8-7a1e-7000-8000-000000000001', sharePct: '100' }],
        },
        expect: 400,
      },
      {
        name: 'a down payment above the price',
        body: {
          name: 'Mau',
          type: 'land',
          purchaseDate: '2021-05-10',
          purchasePrice: '1000',
          downPayment: '2000',
          holders: [{ holderId: '0192f2c8-7a1e-7000-8000-000000000001', sharePct: '100' }],
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/properties/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/route')),
    params: async (s) => ({ id: (await propertyIn(s, 'A')).id }),
    success: { status: 200, schema: PropertyDto },
    foreign: foreignProperty,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/properties/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/route')),
    params: async (s) => ({ id: (await propertyIn(s, 'A')).id }),
    body: () => ({ name: 'Renomeado' }),
    success: { status: 200, schema: PropertyDto },
    foreign: foreignProperty,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/properties/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/route')),
    params: async (s) => ({ id: (await propertyIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignProperty,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/properties/:id/valuations`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/valuations/route')),
    params: async (s) => ({ id: (await propertyIn(s, 'A')).id }),
    success: { status: 200, schema: ValuationListDto },
    foreign: foreignProperty,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/properties/:id/valuations`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/valuations/route')),
    params: async (s) => ({ id: (await propertyIn(s, 'A')).id }),
    body: () => ({ date: '2025-06-30', value: '155000', source: 'bank_appraisal' }),
    success: { status: 201, schema: ValuationDto },
    foreign: async (s) => ({
      ...(await foreignProperty(s)),
      body: { date: '2025-06-30', value: '155000' },
    }),
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/properties/:id/valuations/:valuationId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/properties/[id]/valuations/[valuationId]/route'),
      ),
    params: async (s) => {
      const valuation = await valuationIn(s, 'A');
      return { id: valuation.propertyId, valuationId: valuation.id };
    },
    success: { status: 204 },
    foreign: foreignValuation,
  },

  // ---------------------------------------------------------------- pool scope: loans
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/route')),
    success: { status: 200, schema: LoanListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s loans',
    leaks: async (s) => {
      await loanIn(s, 'A');
      const other = await loanIn(s, 'B');
      return [other.id, 'Crédito Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/loans`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/route')),
    body: () => ({
      name: 'Carro',
      kind: 'car',
      principal: '15000',
      startDate: '2024-01-10',
      firstDueDate: '2024-02-10',
      termMonths: 60,
      rateType: 'fixed',
      annualRate: '5.9',
      paymentDay: 10,
    }),
    success: { status: 201, schema: LoanDto },
    noForeignBecause: 'creates a new row; a property or account of another pool is a negative case',
    negatives: [
      {
        name: 'a variable rate without an index',
        body: {
          name: 'Mau',
          kind: 'mortgage',
          principal: '1000',
          startDate: '2024-01-10',
          firstDueDate: '2024-02-10',
          termMonths: 12,
          rateType: 'variable',
          annualRate: '3',
          paymentDay: 10,
        },
        expect: 400,
      },
      {
        name: 'a property that is not in this pool',
        body: {
          name: 'Mau',
          kind: 'mortgage',
          propertyId: '0192f2c8-7a1e-7000-8000-000000000001',
          principal: '1000',
          startDate: '2024-01-10',
          firstDueDate: '2024-02-10',
          termMonths: 12,
          rateType: 'fixed',
          annualRate: '3',
          paymentDay: 10,
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    success: { status: 200, schema: LoanDto },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/loans/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    body: () => ({ name: 'Renomeado' }),
    success: { status: 200, schema: LoanDto },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/loans/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans/:id/schedule`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/schedule/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    success: { status: 200, schema: ScheduleDto },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans/:id/installments`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/installments/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    success: { status: 200, schema: InstallmentListDto },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/loans/:id/installments`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/installments/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    body: () => ({ number: 1, dueDate: '2020-10-05', capital: '300', interest: '140' }),
    success: { status: 201, schema: InstallmentDto },
    foreign: async (s) => ({
      ...(await foreignLoan(s)),
      body: { number: 1, dueDate: '2020-10-05', capital: '300', interest: '140' },
    }),
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/loans/:id/installments/:installmentId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/installments/[installmentId]/route'),
      ),
    params: async (s) => {
      const installment = await installmentIn(s, 'A');
      return { id: installment.loanId, installmentId: installment.id };
    },
    body: () => ({ interest: '141' }),
    success: { status: 200, schema: InstallmentDto },
    foreign: foreignInstallment,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/loans/:id/installments/:installmentId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/installments/[installmentId]/route'),
      ),
    params: async (s) => {
      const installment = await installmentIn(s, 'A');
      return { id: installment.loanId, installmentId: installment.id };
    },
    success: { status: 204 },
    foreign: foreignInstallment,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/loans/:id/fields`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/fields/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    body: () => ({ key: 'condominium', label: 'Condomínio' }),
    success: { status: 201, schema: LoanFieldDto },
    foreign: async (s) => ({
      ...(await foreignLoan(s)),
      body: { key: 'condominium', label: 'Condomínio' },
    }),
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/loans/:id/fields/:key`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/fields/[key]/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id, key: 'creditInsurance' }),
    body: () => ({ enabled: true }),
    success: { status: 200, schema: LoanFieldDto },
    foreign: async (s) => ({
      ...(await foreignLoan(s)),
      params: { ...(await foreignLoan(s)).params, key: 'creditInsurance' },
      body: { enabled: true },
    }),
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans/:id/events`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/events/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    success: { status: 200, schema: EventListDto },
    foreign: foreignLoan,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/loans/:id/events`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/events/route')),
    params: async (s) => ({ id: (await loanIn(s, 'A')).id }),
    body: () => ({ kind: 'rate_review', date: '2023-03-05', annualRate: '3.5' }),
    success: { status: 201, schema: EventDto },
    foreign: async (s) => ({
      ...(await foreignLoan(s)),
      body: { kind: 'rate_review', date: '2023-03-05', annualRate: '3.5' },
    }),
    negatives: [
      {
        name: 'a prepayment without an effect',
        body: { kind: 'prepayment', date: '2023-02-01', amount: '1000' },
        expect: 400,
      },
      {
        name: 'an installment that does not cover the interest',
        body: { kind: 'rate_review', date: '2023-03-05', annualRate: '3.5', newInstallment: '1' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/loans/:id/events/:eventId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/events/[eventId]/route'),
      ),
    params: async (s) => {
      const event = await eventIn(s, 'A');
      return { id: event.loanId, eventId: event.id };
    },
    success: { status: 204 },
    foreign: foreignEvent,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/loans/:id/review-preview`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/loans/[id]/review-preview/route')),
    params: async (s) => ({ id: (await variableLoanIn(s, 'A')).id }),
    success: { status: 200, schema: ReviewPreviewDto },
    foreign: foreignLoan,
  },

  // ---------------------------------------------------------------- pool scope: works
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/works`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/route')),
    success: { status: 200, schema: WorkListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s works',
    leaks: async (s) => {
      await workIn(s, 'A');
      const other = await workIn(s, 'B');
      return [other.id, 'Cozinha Beta Secreta', 'Fornecedor Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/works`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/route')),
    body: async (s) => ({
      propertyId: (await propertyIn(s, 'A')).id,
      name: 'Casa de banho',
      budget: '3000',
    }),
    success: { status: 201, schema: WorkDto },
    noForeignBecause: 'creates a new row; a property of another pool is a negative case',
    negatives: [
      {
        name: 'a property that is not in this pool',
        body: {
          propertyId: '0192f2c8-7a1e-7000-8000-000000000001',
          name: 'Mau',
          budget: '1000',
        },
        expect: 400,
      },
      {
        name: 'an end before the start',
        body: {
          propertyId: '0192f2c8-7a1e-7000-8000-000000000001',
          name: 'Mau',
          budget: '1000',
          startDate: '2026-05-01',
          plannedEnd: '2026-04-01',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/works/upcoming`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/upcoming/route')),
    success: { status: 200, schema: UpcomingDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s phases',
    leaks: async (s) => {
      await phaseIn(s, 'A');
      const other = await phaseIn(s, 'B');
      return [other.id, 'Sinal Secreto', 'Cozinha Beta Secreta'];
    },
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/works/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/route')),
    params: async (s) => ({ id: (await workIn(s, 'A')).id }),
    success: { status: 200, schema: WorkDto },
    foreign: foreignWork,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/works/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/route')),
    params: async (s) => ({ id: (await workIn(s, 'A')).id }),
    body: () => ({ name: 'Renomeada' }),
    success: { status: 200, schema: WorkDto },
    foreign: foreignWork,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/works/:id`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/route')),
    params: async (s) => ({ id: (await workIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignWork,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/works/:id/payments`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/payments/route')),
    params: async (s) => ({ id: (await workIn(s, 'A')).id }),
    body: () => ({ description: 'Segunda fase', amount: '2460', plannedDate: '2027-01-10' }),
    success: { status: 201, schema: PaymentDto },
    foreign: foreignWork,
    negatives: [{ name: 'a zero amount', body: { description: 'Mau', amount: '0' }, expect: 400 }],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/works/:id/payments/:paymentId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/payments/[paymentId]/route'),
      ),
    params: async (s) => {
      const phase = await phaseIn(s, 'A');
      return { id: phase.projectId, paymentId: phase.id };
    },
    body: () => ({ description: 'Sinal pago', paidDate: '2026-11-20' }),
    success: { status: 200, schema: PaymentDto },
    foreign: foreignPhase,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/works/:id/payments/:paymentId`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/payments/[paymentId]/route'),
      ),
    params: async (s) => {
      const phase = await phaseIn(s, 'A');
      return { id: phase.projectId, paymentId: phase.id };
    },
    success: { status: 204 },
    foreign: foreignPhase,
  },
  {
    scope: 'pool',
    method: 'PUT',
    path: `${POOL}/works/:id/payments/:paymentId/transaction`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/payments/[paymentId]/transaction/route'),
      ),
    params: async (s) => {
      const phase = await phaseIn(s, 'A');
      return { id: phase.projectId, paymentId: phase.id };
    },
    body: async (s) => ({ transactionId: (await transactionIn(s, 'A')).id }),
    success: { status: 200, schema: PaymentDto },
    foreign: foreignPhase,
    negatives: [
      {
        name: 'a movement that is not in this pool',
        body: { transactionId: '0192f2c8-7a1e-7000-8000-000000000001' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/works/:id/payments/:paymentId/transaction`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/works/[id]/payments/[paymentId]/transaction/route'),
      ),
    params: async (s) => {
      // Linked once per scenario: the setup runs for every case of the route.
      const phase = await s.memo('linked-work-phase-A', async () => {
        const created = await phaseIn(s, 'A');
        await s.world.works.linkTransaction(
          await s.as('owner'),
          s.poolA,
          created.projectId,
          created.id,
          { transactionId: (await transactionIn(s, 'A')).id },
        );
        return created;
      });
      return { id: phase.projectId, paymentId: phase.id };
    },
    success: { status: 200, schema: PaymentDto },
    foreign: foreignPhase,
  },

  // ---------------------------------------------------------------- pool scope: property costs
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/property-costs`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/route')),
    success: { status: 200, schema: CostListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s costs',
    leaks: async (s) => {
      await costIn(s, 'A');
      const other = await costIn(s, 'B');
      return [other.id, 'Jardim Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/property-costs`,
    permission: 'realestate.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/route')),
    body: async (s) => ({
      propertyId: (await propertyIn(s, 'A')).id,
      kind: 'imi',
      amount: '412.5',
      periodicity: 'annual',
      startDate: '2026-04-30',
    }),
    success: { status: 201, schema: CostDto },
    noForeignBecause: 'creates a new row; a property of another pool is a negative case',
    negatives: [
      {
        name: 'a property that is not in this pool',
        body: {
          propertyId: '0192f2c8-7a1e-7000-8000-000000000001',
          kind: 'imi',
          amount: '1',
          periodicity: 'annual',
          startDate: '2026-04-30',
        },
        expect: 400,
      },
      {
        name: 'a custom periodicity without its months',
        body: {
          propertyId: '0192f2c8-7a1e-7000-8000-000000000001',
          kind: 'imi',
          amount: '1',
          periodicity: 'custom',
          startDate: '2026-04-30',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/property-costs/upcoming`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/upcoming/route')),
    success: { status: 200, schema: UpcomingCostsDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s costs',
    leaks: async (s) => {
      await costIn(s, 'A');
      const other = await costIn(s, 'B');
      return [other.id, 'Jardim Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/property-costs/totals`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/totals/route')),
    success: { status: 200, schema: CostTotalsDto },
    noForeignBecause: 'sums the URL’s own pool; the leak probe covers pool B’s costs',
    leaks: async (s) => {
      await costIn(s, 'A');
      const other = await costIn(s, 'B');
      return [other.id, 'Jardim Beta Secreto', '987654'];
    },
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/property-costs/:id`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/[id]/route')),
    params: async (s) => ({ id: (await costIn(s, 'A')).id }),
    success: { status: 200, schema: CostDto },
    foreign: foreignCost,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/property-costs/:id`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/[id]/route')),
    params: async (s) => ({ id: (await costIn(s, 'A')).id }),
    body: () => ({ amount: '160' }),
    success: { status: 200, schema: CostDto },
    foreign: foreignCost,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/property-costs/:id`,
    permission: 'realestate.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/[id]/route')),
    params: async (s) => ({ id: (await costIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignCost,
  },
  {
    scope: 'pool',
    method: 'PUT',
    path: `${POOL}/property-costs/:id/payments/:dueDate`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/[id]/payments/[dueDate]/route'),
      ),
    params: async (s) => {
      const cost = await costIn(s, 'A');
      return { id: cost.id, dueDate: cost.startDate };
    },
    body: async (s) => ({ transactionId: (await transactionIn(s, 'A')).id }),
    success: { status: 200, schema: CostPaymentDto },
    foreign: foreignCost,
    negatives: [
      {
        name: 'a movement that is not in this pool',
        body: { transactionId: '0192f2c8-7a1e-7000-8000-000000000001' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/property-costs/:id/payments/:dueDate`,
    permission: 'realestate.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/property-costs/[id]/payments/[dueDate]/route'),
      ),
    params: async (s) => {
      // Linked once per scenario: the setup runs for every case of the route.
      const cost = await s.memo('linked-property-cost-A', async () => {
        const created = await costIn(s, 'A');
        await s.world.propertyCosts.linkPayment(
          await s.as('owner'),
          s.poolA,
          created.id,
          created.startDate,
          { transactionId: (await transactionIn(s, 'A')).id },
        );
        return created;
      });
      return { id: cost.id, dueDate: cost.startDate };
    },
    success: { status: 204 },
    foreign: foreignCost,
  },

  // ---------------------------------------------------------------- pool scope: savings
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/products`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/products/route')),
    success: { status: 200, schema: ProductListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s products',
    leaks: async (s) => {
      await productIn(s, 'A');
      const other = await productIn(s, 'B');
      return [other.id, 'Produto Beta Secreto'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/products`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/products/route')),
    body: () => ({ name: 'Novo produto', rate: '1.75', payN: 1, payU: 'm' }),
    success: { status: 201, schema: ProductDto },
    noForeignBecause: 'creates a new row; an account of another pool is a negative case',
    negatives: [
      {
        name: 'a rate above 100',
        body: { name: 'Mau produto', rate: '100.5' },
        expect: 400,
      },
      {
        name: 'a rate with five decimals',
        body: { name: 'Mau produto', rate: '2.12345' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/products/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/products/[id]/route')),
    params: async (s) => ({ id: (await productIn(s, 'A')).id }),
    success: { status: 200, schema: ProductDto },
    foreign: foreignProduct,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/products/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/products/[id]/route')),
    params: async (s) => ({ id: (await productIn(s, 'A')).id }),
    body: () => ({ rate: '2.75' }),
    success: { status: 200, schema: ProductDto },
    foreign: foreignProduct,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/products/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/products/[id]/route')),
    params: async (s) => ({ id: (await productIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignProduct,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/deposits`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/route')),
    success: { status: 200, schema: DepositListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s deposits',
    leaks: async (s) => {
      await depositIn(s, 'A');
      const other = await depositIn(s, 'B');
      return [other.id, other.accountId];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/deposits`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/route')),
    body: async (s) => ({
      accountId: (await cashAccountIn(s, 'A', 'term_deposit', 2)).id,
      productId: (await productIn(s, 'A')).id,
      capital: '5000',
      start: '2026-03-01',
    }),
    success: { status: 201, schema: DepositDto },
    noForeignBecause: 'creates a new row; an account or product of another pool is a negative case',
    negatives: [
      {
        name: 'a tax above 100',
        body: {
          accountId: '0192f3a1-0000-7000-8000-000000000001',
          capital: '5000',
          start: '2026-03-01',
          rate: '2',
          tax: '101',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/deposits/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/[id]/route')),
    params: async (s) => ({ id: (await depositIn(s, 'A')).id }),
    success: { status: 200, schema: DepositDto },
    foreign: foreignDeposit,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/deposits/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/[id]/route')),
    params: async (s) => ({ id: (await depositIn(s, 'A')).id }),
    body: () => ({ capital: '12000' }),
    success: { status: 200, schema: DepositDto },
    foreign: foreignDeposit,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/deposits/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/[id]/route')),
    params: async (s) => ({ id: (await depositIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignDeposit,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/deposits/:id/schedule`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/deposits/[id]/schedule/route')),
    params: async (s) => ({ id: (await depositIn(s, 'A')).id }),
    query: '?asOf=2026-12-31',
    success: { status: 200, schema: DepositScheduleDto },
    foreign: foreignDeposit,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/interest`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/interest/route')),
    success: { status: 200, schema: InterestListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s entries',
    leaks: async (s) => {
      await interestIn(s, 'A');
      const other = await interestIn(s, 'B');
      return [other.id, other.accountId, 'Nota Beta Secreta'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/interest`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/interest/route')),
    body: async (s) => ({
      accountId: (await cashAccountIn(s, 'A', 'savings')).id,
      date: '2026-03-01',
      amount: '8.5',
    }),
    success: { status: 201, schema: InterestEntryDto },
    noForeignBecause: 'creates a new row; an account of another pool is a negative case',
    negatives: [
      {
        name: 'a negative amount',
        body: {
          accountId: '0192f3a1-0000-7000-8000-000000000001',
          date: '2026-03-01',
          amount: '-1',
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/interest/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/interest/[id]/route')),
    params: async (s) => ({ id: (await interestIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignInterest,
  },

  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/transactions/:id/note`,
    permission: 'notes.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transactions/[id]/note/route')),
    params: async (s) => ({ id: (await transactionIn(s, 'A')).id }),
    body: () => ({ note: 'Paguei com o cartão do João' }),
    success: { status: 200, schema: NoteDto },
    foreign: foreignTransaction,
    negatives: [
      { name: 'a note of 2 001 characters', body: { note: 'x'.repeat(2001) }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/ops/:id/note`,
    permission: 'notes.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/ops/[id]/note/route')),
    params: async (s) => ({ id: (await opIn(s, 'A')).id }),
    body: () => ({ note: 'Reforço mensal' }),
    success: { status: 200, schema: NoteDto },
    foreign: foreignOp,
    negatives: [
      { name: 'a note of 2 001 characters', body: { note: 'x'.repeat(2001) }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/months`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/months/route')),
    query: '?from=2026-01&to=2026-12',
    success: { status: 200, schema: MonthNoteListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s month note',
    leaks: async (s) => {
      await monthNoteB(s);
      return ['Nota do mês Beta Secreta'];
    },
    negatives: [
      { name: 'an invalid month (2026-13)', query: '?from=2026-01&to=2026-13', expect: 400 },
      { name: 'a reversed range', query: '?from=2026-05&to=2026-01', expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/months/:month/note`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/months/[month]/note/route')),
    params: () => Promise.resolve({ month: '2026-03' }),
    success: { status: 200, schema: MonthNoteDto },
    noForeignBecause: 'the month names no resource; the leak probe covers pool B’s note',
    leaks: async (s) => {
      await monthNoteB(s);
      return ['Nota do mês Beta Secreta'];
    },
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/months/:month/review`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/months/[month]/review/route')),
    params: () => Promise.resolve({ month: '2026-03' }),
    success: { status: 200, schema: MonthReviewDto },
    noForeignBecause: 'the month names no resource; the leak probe covers pool B’s month note',
    leaks: async (s) => {
      await monthNoteB(s);
      return ['Nota do mês Beta Secreta'];
    },
  },
  {
    scope: 'pool',
    method: 'PUT',
    path: `${POOL}/months/:month/note`,
    permission: 'notes.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/months/[month]/note/route')),
    params: () => Promise.resolve({ month: '2026-03' }),
    body: () => ({ body: 'Mês de férias', expectedUpdatedAt: null }),
    success: { status: 200, schema: MonthNoteDto },
    noForeignBecause: 'the month names no resource; pool B’s note of the same month is untouched',
    negatives: [
      {
        name: 'a note of 10 001 characters',
        body: { body: 'x'.repeat(10_001), expectedUpdatedAt: null },
        expect: 400,
      },
      { name: 'no version sent', body: { body: 'sem versão' }, expect: 400 },
    ],
  },

  // ---------------------------------------------------------------- exempt, with the reason
  {
    scope: 'exempt',
    method: 'GET',
    path: '/api/v1/auth/*',
    load: () => load(import('../../apps/web/src/app/api/v1/auth/[...all]/route')),
    reason:
      'Better Auth’s own handler (session lookup, verification links): no pool data; covered by tests/services/auth.integration.test.ts and the Origin check in route()',
  },
  {
    scope: 'exempt',
    method: 'POST',
    path: '/api/v1/auth/*',
    load: () => load(import('../../apps/web/src/app/api/v1/auth/[...all]/route')),
    reason:
      'Better Auth’s own handler (sign-up, sign-in, password reset): no pool data; covered by the auth integration tests, which also check the Origin rule and the rate limits',
  },
  {
    scope: 'exempt',
    method: 'GET',
    path: '/api/v1/health',
    load: () => load(import('../../apps/web/src/app/api/v1/health/route')),
    reason: 'public liveness probe: no session, no pool, no data; the body is built from HealthDto',
  },
];

export const POOL_ROUTES = ROUTE_REGISTRY.filter(
  (route): route is PoolRoute => route.scope === 'pool',
);
export const USER_ROUTES = ROUTE_REGISTRY.filter(
  (route): route is UserRoute => route.scope === 'user',
);
