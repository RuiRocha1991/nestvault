/** Value of `?reason=` on the sign-in screen when the session ended without the user asking for it. */
export const SESSION_EXPIRED_REASON = 'expired';

/** Value of `?reason=` after a password reset: the sign-in screen says the password was changed. */
export const PASSWORD_CHANGED_REASON = 'password-changed';

/** Same-origin BroadcastChannel the tabs of one browser use to tell each other about a sign-out. */
export const AUTH_CHANNEL = 'nv-auth';
export const SIGNED_OUT_MESSAGE = 'signed-out';
