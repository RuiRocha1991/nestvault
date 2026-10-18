import type { InvestmentOp } from '@nestvault/domain';

let seq = 0;

/** An investment operation with a unique id; only the fields a test cares about are given. */
export function makeOp(
  partial: Partial<InvestmentOp> & Pick<InvestmentOp, 'type' | 'assetId' | 'date'>,
): InvestmentOp {
  return { id: `op${++seq}`, ...partial };
}

/** Narrows an indexed lookup that the test knows exists. */
export function must<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected a value');
  return value;
}
