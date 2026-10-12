import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No `X-Powered-By: Next.js`, and no source maps for the browser in production (control 18).
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Linting runs in `pnpm lint` and CI with the root flat config.
  eslint: { ignoreDuringBuilds: true },
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@nestvault/ui', '@nestvault/config'],
};

export default withNextIntl(nextConfig);
