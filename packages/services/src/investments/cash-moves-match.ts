import {
  portfolioCashMovesRepo,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { addDays, matchCashMoves } from '@nestvault/domain';

import { loadEngineContext, toEngineTransaction } from '../transactions/engine';

/**
 * Recognises bank movements as the other side of portfolio cash moves made without a mirror: the
 * movement becomes a transfer (not income) and the move remembers it. Looks at the moves and the
 * movements around `date`; run it after a movement is written or a move is recorded.
 */
export async function linkCashMoves(tx: PoolTx, ctx: PoolContext, date: string): Promise<void> {
  const engine = await loadEngineContext(tx, ctx);
  const pending = await portfolioCashMovesRepo.listUnlinked(
    tx,
    ctx,
    addDays(date, -engine.days),
    addDays(date, engine.days),
  );
  if (pending.length === 0) return;

  const dates = pending.map((move) => move.date).sort();
  const first = dates[0] ?? date;
  const last = dates[dates.length - 1] ?? date;
  const [window, all] = await Promise.all([
    transactionsRepo.window(tx, ctx, addDays(first, -engine.days), addDays(last, engine.days)),
    portfolioCashMovesRepo.list(tx, ctx),
  ]);
  const linked = new Set(all.flatMap((move) => (move.transactionId ? [move.transactionId] : [])));

  const matches = matchCashMoves(
    pending.map((move) => ({
      id: move.id,
      accountId: move.accountId,
      date: move.date,
      amount: move.amount,
    })),
    window.map(toEngineTransaction),
    engine.transferAccounts,
    engine.categories,
    { days: engine.days, linked },
  );
  for (const match of matches) {
    await transactionsRepo.update(tx, ctx, match.transactionId, {
      transfer: true,
      ...(match.setCategory && match.categoryId ? { categoryId: match.categoryId } : {}),
    });
    await portfolioCashMovesRepo.linkTransaction(tx, ctx, match.moveId, match.transactionId);
  }
}
