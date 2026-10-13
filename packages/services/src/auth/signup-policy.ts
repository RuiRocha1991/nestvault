/**
 * Decides whether a sign-up request may proceed. Closed by default (`ALLOW_SIGNUP=false`): people
 * join with an invite for the same email. Invites live in NES-25; until then the verifier is a
 * port that rejects everything, so only `ALLOW_SIGNUP=true` opens registration.
 */
export interface InviteVerifier {
  /** True when `token` is a valid, unused, unexpired invite issued for exactly `email`. */
  isValid(input: { token: string; email: string }): Promise<boolean>;
}

export const NO_INVITES: InviteVerifier = { isValid: () => Promise.resolve(false) };

export const INVITE_TOKEN_HEADER = 'x-invite-token';

export async function isSignupAllowed(input: {
  allowSignup: boolean;
  email: string;
  inviteToken: string | null | undefined;
  invites: InviteVerifier;
}): Promise<boolean> {
  if (input.allowSignup) return true;
  if (!input.inviteToken) return false;
  return input.invites.isValid({ token: input.inviteToken, email: input.email });
}
