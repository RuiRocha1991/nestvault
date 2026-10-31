import {
  depositsRepo,
  poolSettingsRepo,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import {
  addDays,
  depositFlows,
  depositReturnTo,
  linkDepositFlows,
  type DepositFlow,
  type DepositLinkDecision,
  type LinkableTransaction,
} from '@nestvault/domain';

import { isUniqueViolation } from '../db-errors';
import { toDomainDeposit } from '../savings/domain';

const DEFAULT_DEPOSIT_TAX = '28';

export interface LinkDepositsOutcome {
  /** Statement lines linked to a deposit flow in this run. */
  linked: number;
  /** Of those, the ones marked as the interest of a deposit. */
  interest: number;
  /** Of those, the ones that became internal transfers (capital out, redemption back). */
  transfers: number;
}

/**
 * Matches the pool's statement lines to the flows its term deposits expect (capital out, interest
 * in, capital back) and records the links (NES-68): the flow key on the line, `dep_link` for
 * interest and the transfer flag for capital and redemptions. Idempotent: a line or a flow that is
 * already linked is skipped, and the database writes only lines that have no link yet. A line whose
 * transfer flag the user fixed keeps it. Runs inside `withPool` of the pool in `ctx`.
 */
export async function linkDepositsInPool(
  tx: PoolTx,
  ctx: PoolContext,
  today: string,
): Promise<LinkDepositsOutcome> {
  const outcome: LinkDepositsOutcome = { linked: 0, interest: 0, transfers: 0 };
  const rows = await depositsRepo.list(tx, ctx);
  if (rows.length === 0) return outcome;

  const settings = await poolSettingsRepo.find(tx, ctx);
  const defaultTax = settings?.depositTax ?? DEFAULT_DEPOSIT_TAX;
  const deposits = rows.map(toDomainDeposit);

  // The accounts that see a flow: where it is funded, where interest arrives, where it is returned.
  const accountIds = new Set<string>();
  for (const deposit of deposits) {
    for (const id of [deposit.fundFrom, deposit.payTo, depositReturnTo(deposit)]) {
      if (id) accountIds.add(id);
    }
  }
  // Only lines a flow can match: from five days before the first deposit to five days from now,
  // plus the lines that already carry a link (their keys stop a flow from linking twice).
  const from = addDays(deposits.map((d) => d.start ?? today).sort()[0] ?? today, -5);
  const candidates = await transactionsRepo.listForDepositLink(
    tx,
    ctx,
    [...accountIds],
    from,
    addDays(today, 5),
  );

  const linesByAccount = new Map<string, LinkableTransaction[]>();
  for (const { depositFlowKey, ...line } of candidates) {
    const lines = linesByAccount.get(line.accountId) ?? [];
    lines.push({ ...line, depositLink: depositFlowKey });
    linesByAccount.set(line.accountId, lines);
  }
  const decisions: DepositLinkDecision[] = [];
  for (const accountId of accountIds) {
    const flows: DepositFlow[] = depositFlows(accountId, deposits, today, defaultTax);
    if (flows.length > 0) {
      decisions.push(...linkDepositFlows(linesByAccount.get(accountId) ?? [], flows));
    }
  }

  for (const decision of decisions) {
    // A savepoint per line: a flow another run linked first (unique index) skips this line only.
    const done = await tx
      .transaction((sp) =>
        transactionsRepo.linkDepositFlow(sp, ctx, decision.transactionId, {
          flowKey: decision.flowKey,
          depositInterest: decision.markAsDepositInterest,
          transfer: decision.markAsTransfer,
        }),
      )
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return false;
        throw error;
      });
    if (!done) continue;
    outcome.linked += 1;
    if (decision.markAsDepositInterest) outcome.interest += 1;
    if (decision.markAsTransfer) outcome.transfers += 1;
  }
  return outcome;
}
