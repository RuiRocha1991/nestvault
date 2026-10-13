import { AUTH_CHANNEL, SIGNED_OUT_MESSAGE } from './session-reason';

let channel: BroadcastChannel | null | undefined;

/**
 * The one BroadcastChannel of this page, or `null` where the browser has none (the periodic and
 * on-focus checks still work there). Sender and listener must be the same object: a channel never
 * hears its own messages, but a second channel in the same tab would, and the tab that just signed
 * out would then treat its own sign-out as "ended elsewhere".
 */
export function authChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUTH_CHANNEL);
  }
  return channel;
}

/** Tells the other tabs of this browser that the user signed out. Never throws. */
export function announceSignOut(): void {
  try {
    authChannel()?.postMessage(SIGNED_OUT_MESSAGE);
  } catch {
    // Other tabs then notice on their next check; the sign-out itself already happened.
  }
}
