import { dec, toPlain } from './decimal';
import { hashText, normalizeText } from './text';

/**
 * The de-duplication key of a bank movement inside its account: SHA-256 of
 * `account + date + normalized description + amount + '#' + occurrence`. It is the prototype's
 * scheme (`hashRows`) with SHA-256 instead of the 32-bit `hashStr`, and the new account id.
 * `occurrence` counts identical lines of the same account (1 for the first), so two real identical
 * coffees on the same day stay two movements. The amount is its plain decimal text (`-13.99`,
 * `-45`), whatever the way it was written, so `-45`, `-45.00` and `-45.0000` give the same key.
 */
export function transactionHash(
  line: { accountId: string; date: string; description: string; amount: string },
  occurrence: number,
): string {
  const amount = toPlain(dec(line.amount));
  return hashText(
    `${line.accountId}${line.date}${normalizeText(line.description)}${amount}#${occurrence}`,
  );
}
