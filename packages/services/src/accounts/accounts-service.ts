import {
  accountsRepo,
  holdersRepo,
  investmentOpsRepo,
  isUuid,
  newId,
  plansRepo,
  poolSettingsRepo,
  portfoliosRepo,
  subAccountsRepo,
  transactionsRepo,
  withPool,
  type AccountRow,
  type AccountValues,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import { accountBalances, dec, toFxRates, toEur } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { CASH_ACCOUNT_TYPES } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';
import { toEngineTransaction } from '../transactions/engine';

import { toLedgerAccount } from './ledger';
import {
  AccountDto,
  AccountListDto,
  CreateAccountInput,
  SubAccountDto,
  SubAccountInput,
  toAccountDto,
  toSubAccountDto,
  UpdateAccountInput,
  UpdateSubAccountInput,
} from './schemas';

export interface AccountsService {
  /** Every account of the pool with its balance today (any member). */
  list(headers: Headers, poolId: string): Promise<AccountListDto>;
  /** One account (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<AccountDto>;
  /** Creates an account with its holders and, for a brokerage account, its sub-accounts (`accounts.write`). */
  create(headers: Headers, poolId: string, input: unknown): Promise<AccountDto>;
  /** Changes an account; fields left out stay (`accounts.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<AccountDto>;
  /** Deletes an account; 409 while it has movements (`accounts.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  createSubAccount(
    headers: Headers,
    poolId: string,
    accountId: string,
    input: unknown,
  ): Promise<SubAccountDto>;
  updateSubAccount(
    headers: Headers,
    poolId: string,
    accountId: string,
    id: string,
    input: unknown,
  ): Promise<SubAccountDto>;
  removeSubAccount(headers: Headers, poolId: string, accountId: string, id: string): Promise<void>;
}

export interface AccountsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

export function createAccountsService(deps: AccountsServiceDeps): AccountsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** Accounts as DTOs, with the balance today and its EUR value (the pool's rates). */
  async function read(tx: PoolTx, ctx: PoolContext, only?: string): Promise<AccountDto[]> {
    const today = now().toISOString().slice(0, 10);
    const rows = only
      ? [await accountsRepo.find(tx, ctx, only)].filter((row): row is AccountRow => !!row)
      : await accountsRepo.list(tx, ctx);
    const ids = rows.map((row) => row.id);
    const [links, subs, resolved, settings, savings, txRows] = await Promise.all([
      accountsRepo.listHolders(tx, ctx, ids),
      subAccountsRepo.list(tx, ctx),
      loadFxRates(tx, ctx, today),
      poolSettingsRepo.find(tx, ctx),
      loadSavingsLedger(tx, ctx),
      transactionsRepo.listForEngine(tx, ctx),
    ]);
    const rates = toFxRates(resolved);
    // Movements, deposits and manual interest feed the balance; operations join them as their
    // module is wired in (the same domain function reads them all).
    const balances = accountBalances(
      {
        accounts: rows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
        transactions: txRows.map(toEngineTransaction),
        interestEntries: savings.interestEntries,
        ops: [],
        assets: [],
        moves: [],
        categories: [],
        rates,
        defaultTax: settings?.depositTax ?? '28',
      },
      today,
    );
    return rows.map((row) => {
      const balance = balances.get(row.id) ?? dec(0);
      return toAccountDto(
        row,
        links.filter((link) => link.accountId === row.id).map((link) => link.holderId),
        subs.filter((sub) => sub.accountId === row.id),
        balance,
        toEur(balance, row.currency, rates),
      );
    });
  }

  /** The holders must be people of this pool. */
  async function assertHolders(tx: PoolTx, ctx: PoolContext, ids: readonly string[]) {
    const known = new Set((await holdersRepo.list(tx, ctx)).map((holder) => holder.id));
    if (ids.some((id) => !known.has(id.toLowerCase()))) {
      throw invalid('holderIds', 'not a person of this pool');
    }
  }

  const toValues = (
    merged: Omit<AccountValues, 'opening' | 'trackCash'> & {
      opening?: string | undefined;
      trackCash?: boolean | undefined;
    },
  ): AccountValues => ({
    ...merged,
    opening: merged.opening ?? '0',
    trackCash: merged.trackCash ?? true,
  });

  /** The linked portfolio must be the pool's own. */
  async function assertPortfolio(tx: PoolTx, ctx: PoolContext, id: string | null) {
    if (id && !(await portfoliosRepo.find(tx, ctx, id))) {
      throw invalid('portfolioId', 'not a portfolio of this pool');
    }
  }

  /** Rules that span fields: a term deposit is in euros, an IBAN is a text and so on. */
  function assertShape(values: AccountValues) {
    if (values.type === 'term_deposit' && values.currency !== 'EUR') {
      throw invalid('currency', 'a term deposit is in EUR');
    }
  }

  function conflictOrRethrow(error: unknown): never {
    if (isUniqueViolation(error)) throw new ConflictError('An account with this IBAN exists.');
    if (isForeignKeyViolation(error)) throw invalid('holderIds', 'not a person of this pool');
    throw error;
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      return AccountListDto.parse({ accounts: await run(ctx, (tx) => read(tx, ctx)) });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const accountId = parseId(id);
      const [found] = await run(ctx, (tx) => read(tx, ctx, accountId));
      if (!found) throw new NotFoundError();
      return AccountDto.parse(found);
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateAccountInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const data = parsed.data;
      if (data.subAccounts?.length && data.type !== 'brokerage') {
        throw invalid('subAccounts', 'only a brokerage account has sub-accounts');
      }
      const values = toValues({
        type: data.type,
        name: data.name,
        institution: data.institution ?? null,
        iban: data.iban ?? null,
        currency: data.currency,
        opening: data.opening,
        openingDate: data.openingDate ?? null,
        trackCash: data.trackCash,
        groupName: data.groupName ?? null,
        portfolioId: data.portfolioId?.toLowerCase() ?? null,
        rate: data.rate ?? null,
        xtbAccountNo: data.xtbAccountNo ?? null,
      });
      assertShape(values);

      const id = newId();
      const holderIds = data.holderIds.map((holderId) => holderId.toLowerCase());
      for (const sub of data.subAccounts ?? []) {
        if (sub.holderId && !holderIds.includes(sub.holderId.toLowerCase())) {
          throw invalid('subAccounts', 'a sub-account holder must own the account');
        }
      }
      try {
        await run(ctx, async (tx) => {
          await assertHolders(tx, ctx, holderIds);
          await assertPortfolio(tx, ctx, values.portfolioId);
          await accountsRepo.insert(tx, ctx, id, values);
          await accountsRepo.setHolders(tx, ctx, id, holderIds);
          for (const sub of data.subAccounts ?? []) {
            await subAccountsRepo.insert(tx, ctx, id, newId(), {
              name: sub.name,
              holderId: sub.holderId?.toLowerCase() ?? null,
            });
          }
        });
      } catch (error) {
        conflictOrRethrow(error);
      }
      await recordAudit(identity, ctx, 'account.created', { target: id, ip: ipOf(headers) });
      const [created] = await run(ctx, (tx) => read(tx, ctx, id));
      if (!created) throw new NotFoundError();
      return AccountDto.parse(created);
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateAccountInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const accountId = parseId(id);
      const data = parsed.data;

      try {
        await run(ctx, async (tx) => {
          const current = await accountsRepo.find(tx, ctx, accountId);
          if (!current) throw new NotFoundError();
          const values = toValues({
            type: data.type ?? current.type,
            name: data.name ?? current.name,
            institution: data.institution === undefined ? current.institution : data.institution,
            iban: data.iban === undefined ? current.iban : data.iban,
            currency: data.currency ?? current.currency,
            opening: data.opening ?? current.opening,
            openingDate: data.openingDate === undefined ? current.openingDate : data.openingDate,
            trackCash: data.trackCash ?? current.trackCash,
            groupName: data.groupName === undefined ? current.groupName : data.groupName,
            portfolioId:
              data.portfolioId === undefined
                ? current.portfolioId
                : (data.portfolioId?.toLowerCase() ?? null),
            rate: data.rate === undefined ? current.rate : data.rate,
            xtbAccountNo:
              data.xtbAccountNo === undefined ? current.xtbAccountNo : data.xtbAccountNo,
          });
          assertShape(values);
          await assertPortfolio(tx, ctx, values.portfolioId);
          const subs = (await subAccountsRepo.list(tx, ctx)).filter(
            (sub) => sub.accountId === accountId,
          );
          if (values.type !== 'brokerage' && subs.length > 0) {
            throw new ConflictError('Remove the sub-accounts before changing the account type.');
          }
          if (!CASH_ACCOUNT_TYPES.has(values.type)) {
            const [ops, plans] = await Promise.all([
              investmentOpsRepo.countByAccount(tx, ctx, accountId),
              plansRepo.countByAccount(tx, ctx, accountId),
            ]);
            if (ops + plans > 0) {
              throw new ConflictError(
                'This account has investment operations or plans; its type cannot change.',
              );
            }
          }
          const holderIds = data.holderIds?.map((holderId) => holderId.toLowerCase());
          if (holderIds) {
            await assertHolders(tx, ctx, holderIds);
            const named = subs.find((sub) => sub.holderId && !holderIds.includes(sub.holderId));
            if (named) {
              throw new ConflictError('A sub-account is named after a person you are removing.');
            }
          }
          await accountsRepo.update(tx, ctx, accountId, values);
          if (holderIds) await accountsRepo.setHolders(tx, ctx, accountId, holderIds);
        });
      } catch (error) {
        conflictOrRethrow(error);
      }
      await recordAudit(identity, ctx, 'account.updated', { target: accountId, ip: ipOf(headers) });
      const [updated] = await run(ctx, (tx) => read(tx, ctx, accountId));
      if (!updated) throw new NotFoundError();
      return AccountDto.parse(updated);
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const accountId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await accountsRepo.find(tx, ctx, accountId))) throw new NotFoundError();
        if ((await accountsRepo.countReferences(tx, ctx, accountId)) > 0) {
          throw new ConflictError('This account has movements. Remove them first.');
        }
        await accountsRepo.remove(tx, ctx, accountId);
      });
      await recordAudit(identity, ctx, 'account.deleted', { target: accountId, ip: ipOf(headers) });
    },

    async createSubAccount(headers, poolId, accountId, input) {
      const session = await requireSession(auth, headers);
      const parsed = SubAccountInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const parentId = parseId(accountId);
      const id = newId();
      let created;
      try {
        created = await run(ctx, async (tx) => {
          const account = await accountsRepo.find(tx, ctx, parentId);
          if (!account) throw new NotFoundError();
          if (account.type !== 'brokerage') {
            throw invalid('accountId', 'only a brokerage account has sub-accounts');
          }
          const holderId = parsed.data.holderId?.toLowerCase() ?? null;
          if (holderId) {
            const owners = await accountsRepo.listHolders(tx, ctx, [parentId]);
            if (!owners.some((link) => link.holderId === holderId)) {
              throw invalid('holderId', 'the holder must own the account');
            }
          }
          return subAccountsRepo.insert(tx, ctx, parentId, id, {
            name: parsed.data.name,
            holderId,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError('This sub-account name is taken.');
        throw error;
      }
      await recordAudit(identity, ctx, 'account.sub_account_created', {
        target: id,
        ip: ipOf(headers),
      });
      return SubAccountDto.parse(toSubAccountDto(created));
    },

    async updateSubAccount(headers, poolId, accountId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateSubAccountInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const parentId = parseId(accountId);
      const subId = parseId(id);
      let updated;
      try {
        updated = await run(ctx, async (tx) => {
          const current = await subAccountsRepo.find(tx, ctx, parentId, subId);
          if (!current) throw new NotFoundError();
          const holderId =
            parsed.data.holderId === undefined
              ? current.holderId
              : (parsed.data.holderId?.toLowerCase() ?? null);
          if (holderId && holderId !== current.holderId) {
            const owners = await accountsRepo.listHolders(tx, ctx, [parentId]);
            if (!owners.some((link) => link.holderId === holderId)) {
              throw invalid('holderId', 'the holder must own the account');
            }
          }
          return subAccountsRepo.update(tx, ctx, parentId, subId, {
            name: parsed.data.name ?? current.name,
            holderId,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError('This sub-account name is taken.');
        throw error;
      }
      if (!updated) throw new NotFoundError();
      await recordAudit(identity, ctx, 'account.sub_account_updated', {
        target: subId,
        ip: ipOf(headers),
      });
      return SubAccountDto.parse(toSubAccountDto(updated));
    },

    async removeSubAccount(headers, poolId, accountId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const parentId = parseId(accountId);
      const subId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await subAccountsRepo.find(tx, ctx, parentId, subId))) throw new NotFoundError();
        if ((await subAccountsRepo.countReferences(tx, ctx, subId)) > 0) {
          throw new ConflictError('This sub-account has operations. Remove them first.');
        }
        await subAccountsRepo.remove(tx, ctx, parentId, subId);
      });
      await recordAudit(identity, ctx, 'account.sub_account_deleted', {
        target: subId,
        ip: ipOf(headers),
      });
    },
  };
}
