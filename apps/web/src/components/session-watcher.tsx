'use client';

import { useEffect } from 'react';

import { authChannel } from '@webapp/lib/auth-channel';
import { SESSION_EXPIRED_REASON, SIGNED_OUT_MESSAGE } from '@webapp/lib/session-reason';

const CHECK_EVERY_MS = 60_000;

/**
 * Notices a session that ended while this tab stayed open (signed out in another tab, revoked
 * elsewhere, expired) and sends the user to the sign-in screen with the expiry message. A server
 * layout does not run again on in-app navigation, and once the cookie is gone the server cannot tell
 * "ended" from "never signed in", so the tab itself checks: when it is shown again, once a minute,
 * and at once when another tab of this browser signs out. Not a security check: the data is
 * guarded on the server.
 */
export function SessionWatcher() {
  useEffect(() => {
    let leaving = false;
    let checking = false;

    const leave = () => {
      if (leaving) return; // focus, visibility and the channel can all fire together
      leaving = true;
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(
        `/login?next=${encodeURIComponent(next)}&reason=${SESSION_EXPIRED_REASON}`,
      );
    };

    async function check() {
      if (checking || leaving) return;
      checking = true;
      try {
        // `disableRefresh`: asking must not count as activity, or an idle open tab would keep the
        // sliding session alive forever.
        const response = await fetch('/api/v1/auth/get-session?disableRefresh=true', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (response.status === 401) leave();
        else if (response.ok && (await response.json()) === null) leave();
        // Any other status (429 from the rate limiter, 5xx) says nothing about the session.
      } catch {
        // Offline or the server is restarting: that is not an ended session.
      } finally {
        checking = false;
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', checkWhenVisible);
    const timer = window.setInterval(checkWhenVisible, CHECK_EVERY_MS);

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.data === SIGNED_OUT_MESSAGE) leave();
    };
    const channel = authChannel();
    channel?.addEventListener('message', onMessage);

    return () => {
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', checkWhenVisible);
      window.clearInterval(timer);
      channel?.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}
