import { formatMoney } from '@nestvault/ui';
import { Landmark, PiggyBank, Percent, TrendingUp, type LucideIcon } from 'lucide-react';

import { emptyAccountForm, type AccountForm, type AccountType } from './account-form';
import type { AccountCard as AccountCardDto } from './accounts-types';

/** Section order of the screen, with each type's data colour (CSS variable) and icon. */
export const TYPE_META: Readonly<
  Record<AccountType, { color: string; icon: LucideIcon; messageKey: string }>
> = {
  checking: { color: 'var(--c-blue)', icon: Landmark, messageKey: 'checking' },
  savings: { color: 'var(--c-teal)', icon: Percent, messageKey: 'savings' },
  term_deposit: { color: 'var(--c-yellow)', icon: PiggyBank, messageKey: 'termDeposit' },
  brokerage: { color: 'var(--c-violet)', icon: TrendingUp, messageKey: 'brokerage' },
};

export const TYPE_ORDER = ['checking', 'savings', 'term_deposit', 'brokerage'] as const;

/** The tile background of a type colour: the colour at 18% over the panel. */
export const tileBackground = (color: string) => `color-mix(in srgb, ${color} 18%, transparent)`;

/** `5285,98 €`, or `1 361,87 US$ (1 252,92 €)` for an account in another currency. */
export function balanceText(account: Pick<AccountCardDto, 'balance' | 'balanceEur' | 'currency'>) {
  const own = formatMoney(account.balance, account.currency);
  return account.currency === 'EUR' ? own : `${own} (${formatMoney(account.balanceEur)})`;
}

/** The people who own an account, by name, in the order of `holders`. */
export function holderNames(
  holderIds: readonly string[],
  holders: readonly { id: string; name: string }[],
): string {
  return holders
    .filter((holder) => holderIds.includes(holder.id))
    .map((holder) => holder.name)
    .join(' & ');
}

/** A card's editable fields as the form starts. */
export function accountToForm(card: AccountCardDto): AccountForm {
  const form = emptyAccountForm(card.type);
  const term = card.term;
  return {
    ...form,
    name: card.name,
    institution: card.institution ?? '',
    holderIds: [...card.holderIds],
    iban: card.iban ?? '',
    currency: card.currency,
    opening: card.opening === '0' ? '' : card.opening,
    openingDate: card.openingDate ?? '',
    groupName: card.groupName ?? '',
    portfolioId: card.portfolioId ?? '',
    rate: card.rate ?? '',
    trackCash: card.trackCash,
    xtbAccountNo: card.xtbAccountNo ?? '',
    subAccounts: card.subAccounts.map((sub) => ({
      id: sub.id,
      name: sub.name,
      holderId: sub.holderId ?? '',
    })),
    ...(term
      ? {
          productId: term.productId ?? '',
          capital: term.capital,
          start: term.start,
          rate: term.rate,
          payN: term.payN === null ? '' : String(term.payN),
          payU: term.payU ?? 'm',
          termN: term.termN === null ? '' : String(term.termN),
          termU: term.termU ?? 'm',
          tax: term.tax,
          payToAccountId: term.payToAccountId ?? '',
          fundFromAccountId: term.fundFromAccountId ?? '',
        }
      : {}),
  };
}
