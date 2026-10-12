import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Linting runs in `pnpm lint` and CI with the root flat config.
  eslint: { ignoreDuringBuilds: true },
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@nestvault/ui'],
};

export default withNextIntl(nextConfig);
