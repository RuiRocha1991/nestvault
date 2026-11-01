# ADR 0005 — Referral programme (credit, not cash)

- **Status:** Accepted (design). Implemented with billing (Stripe), after ADR 0003.
- **Date:** 2026-10-23

## Decision

- Every user has one referral code, unique, stored in the identity DB (`referral_codes`).
- A referral is attributed at sign-up through the invite or referral link. A referee counts only
  after a **paid** charge succeeds on a subscription they own. Trials, free plans, and joining a
  pool as a member (no subscription of their own) do not count.
- **Reward:** the referrer receives **10% of every payment** made by each referee's subscription,
  first payment and every renewal, granted as **credit in euros** on the referrer's subscription.
- **Cap:** at most **60 € of credit per calendar year** per referrer. Payments above the cap still
  count for the referee, but no further credit is granted to the referrer that year.
- Credit is **never cash**. It is applied to future subscription invoices of any plan and cannot
  be withdrawn.
- **Anti-fraud:** no reward when the referee's payment method, email domain or sign-up IP matches
  the referrer's, or when the two accounts share a pool they co-own. Flagged referrals are held for
  review.
- Credit is written to an append-only ledger (`referral_credits`: user_id, amount, source payment
  id, granted_at), keyed by the payment id so a replayed webhook never grants twice.
- Amounts are never logged (security baseline, control 15).

## Open points (to decide before implementation)

- **Base of the 10%:** amount paid excluding IVA or including IVA. To confirm with the accountant.
- **Referee benefit:** whether the referee also gets a discount on first payment.
- **Credit expiry:** whether unused credit expires (proposed: 12 months after it was granted).

## Consequences

- The cost per referee is bounded: at most 10% of their payments, and at most 60 € per referrer
  per year. A monthly Raiz referee (4 €/month) yields 0,40 € per month.
- Credit lives in the identity DB, not in the app DB, since it belongs to the user and not to a pool.
- The plan level of the referrer is irrelevant to the credit amount.
