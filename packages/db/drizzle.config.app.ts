import { migratorEnv } from '@nestvault/config/node';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/app/schema/index.ts',
  out: './migrations/app',
  dbCredentials: { url: migratorEnv().MIGRATOR_URL_APP },
});
