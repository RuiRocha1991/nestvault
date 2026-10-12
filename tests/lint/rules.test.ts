import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({
  cwd: process.cwd(),
  // Fixture paths do not exist on disk, so type-aware linting is switched off for these checks.
  overrideConfig: [{ ...tseslint.configs.disableTypeChecked, files: ['**/*.ts'] }],
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const sqlRaw = "import { sql } from 'drizzle-orm';\nexport const q = sql.raw('select 1');\n";
const envRead = 'export const url = process.env.DATABASE_URL;\n';

describe('sql.raw restriction', () => {
  it('fails outside migrations', async () => {
    expect(await ruleIds(sqlRaw, 'packages/services/src/bad.ts')).toContain('no-restricted-syntax');
  });

  it('is allowed in packages/db migrations', async () => {
    expect(await ruleIds(sqlRaw, 'packages/db/app/migrations/0001.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });
});

describe('process.env restriction', () => {
  it('fails outside packages/config', async () => {
    expect(await ruleIds(envRead, 'packages/services/src/bad.ts')).toContain(
      'no-restricted-syntax',
    );
  });

  it('is allowed in packages/config', async () => {
    expect(await ruleIds(envRead, 'packages/config/src/env.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });
});
