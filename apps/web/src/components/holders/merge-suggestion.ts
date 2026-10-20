import type { HolderView } from './holder-dialog';

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The member a person added by hand probably is: the same name, ignoring case and accents. It only
 * feeds a suggestion in the people screen; nothing is ever merged without the user confirming.
 */
export function suggestedMergeTarget(
  holder: HolderView,
  holders: readonly HolderView[],
): HolderView | undefined {
  if (holder.member) return undefined;
  const name = normalize(holder.name);
  return holders.find((one) => one.member && one.id !== holder.id && normalize(one.name) === name);
}
