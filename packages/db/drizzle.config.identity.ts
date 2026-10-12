import { migratorEnv } from '@nestvault/config/node';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/identity/schema/index.ts',
  out: './migrations/identity',
  dbCredentials: { url: migratorEnv().MIGRATOR_URL_IDENTITY },
});
