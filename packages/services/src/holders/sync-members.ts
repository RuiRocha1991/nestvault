import {
  holdersRepo,
  newId,
  poolMembersRepo,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
} from '@nestvault/db';

import { nextHolderColor } from './palette';
import { HOLDER_NAME_MAX } from './schemas';

/** The name a member's holder starts with; the person can rename it afterwards. */
const holderNameOf = (name: string) => Array.from(name.trim()).slice(0, HOLDER_NAME_MAX).join('');

/**
 * Every member of the pool is a holder (PRD 04): the people who signed up with an email appear
 * without anybody adding them, and people without a login are added by hand next to them. Members
 * missing a holder get one here (name from their profile, next unused colour, no aliases); a holder
 * outlives its member, so removing a member never removes the accounts attributed to them.
 *
 * It is idempotent and safe to run in parallel (`insertLinked` skips existing links). The ids of
 * the current members are returned for the caller to flag them in the DTOs. The membership lives
 * in the identity database, so this is the only place where the two sides meet.
 */
export async function ensureMemberHolders(
  deps: { identity: IdentityDatabase; run: PoolRunner; now: () => Date },
  ctx: PoolContext,
): Promise<ReadonlySet<string>> {
  const members = await poolMembersRepo.listMembers(deps.identity.db, ctx.poolId, deps.now());
  const memberIds = new Set(members.map((member) => member.userId));
  await deps.run(ctx, async (tx) => {
    const existing = await holdersRepo.list(tx, ctx);
    const linked = new Set(existing.map((holder) => holder.userId));
    const colors = existing.map((holder) => holder.color);
    const missing = [];
    for (const member of members) {
      if (linked.has(member.userId)) continue;
      const color = nextHolderColor(colors);
      colors.push(color);
      missing.push({
        id: newId(),
        name: holderNameOf(member.name) || 'Membro',
        color,
        userId: member.userId,
      });
    }
    await holdersRepo.insertLinked(tx, ctx, missing);
  });
  return memberIds;
}
