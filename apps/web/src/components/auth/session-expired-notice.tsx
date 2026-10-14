'use client';

import { useToast } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

/**
 * Toast shown once when the sign-in screen is reached because the session ended. `reason` is then
 * removed from the address, so a reload or going back does not show it again.
 */
export function SessionExpiredNotice({
  message: key = 'sessionExpired',
}: {
  message?: 'sessionExpired' | 'passwordChanged';
}) {
  const t = useTranslations('auth');
  const toast = useToast();
  const message = t(key);
  const shown = useRef(false); // React StrictMode runs effects twice in development

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.show(message);
    const url = new URL(window.location.href);
    url.searchParams.delete('reason');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, [toast, message]);

  return null;
}
