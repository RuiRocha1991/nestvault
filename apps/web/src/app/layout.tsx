import { ToastProvider } from '@nestvault/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { parseTheme, THEME_COOKIE } from '../lib/theme';

import { jetBrainsMono, plusJakartaSans } from './fonts';

import './globals.css';

export const metadata: Metadata = {
  title: 'Cofre Familiar',
  description: 'Finanças familiares',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // The saved theme is rendered into <html> on the server, so the first paint is already right.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${plusJakartaSans.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
