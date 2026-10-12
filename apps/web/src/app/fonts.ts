import localFont from 'next/font/local';

// Self-hosted (design/fonts): no request to Google Fonts at runtime, so the CSP can stay on 'self'.
export const plusJakartaSans = localFont({
  variable: '--font-jakarta',
  display: 'swap',
  src: [
    {
      path: '../../../../design/fonts/plus-jakarta-sans-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../../../design/fonts/plus-jakarta-sans-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../../../design/fonts/plus-jakarta-sans-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../../../design/fonts/plus-jakarta-sans-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../../../../design/fonts/plus-jakarta-sans-latin-800-normal.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
});

export const jetBrainsMono = localFont({
  variable: '--font-jetbrains',
  display: 'swap',
  src: [
    {
      path: '../../../../design/fonts/jetbrains-mono-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../../../design/fonts/jetbrains-mono-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
});
