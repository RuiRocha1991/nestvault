import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({
  cwd: process.cwd(),
  // Fixture paths do not exist on disk, so type-aware linting is switched off for these checks.
  overrideConfig: [{ ...tseslint.configs.disableTypeChecked, files: ['**/*.ts', '**/*.tsx'] }],
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

describe('PoolContext restrictions (architecture rule 3)', () => {
  const factoryImport =
    "import { createPoolContext } from '@nestvault/db/pool-context-factory';\nexport const f = createPoolContext;\n";
  const cast =
    "import type { PoolContext } from '@nestvault/db';\nexport const forged = {} as PoolContext;\n";

  it('only services, the db package and tests may import the factory', async () => {
    expect(await ruleIds(factoryImport, 'packages/services/src/guards.ts')).not.toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(factoryImport, 'packages/db/src/index.ts')).not.toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(factoryImport, 'tests/db/harness.ts')).not.toContain(
      'no-restricted-imports',
    );
    for (const path of [
      'apps/web/src/app/page.ts',
      'apps/worker/src/jobs.ts',
      'packages/ui/src/x.ts',
      'packages/domain/src/x.ts',
    ]) {
      expect(await ruleIds(factoryImport, path), path).toContain('no-restricted-imports');
    }
  });

  it('forbids the angle-bracket cast and the double cast too', async () => {
    const angle =
      "import type { PoolContext } from '@nestvault/db';\nexport const forged = <PoolContext>{};\n";
    const double =
      "import type { PoolContext } from '@nestvault/db';\nexport const forged = JSON.parse('{}') as unknown as PoolContext;\n";
    for (const code of [angle, double]) {
      expect(await ruleIds(code, 'packages/services/src/guards.ts')).toContain(
        'no-restricted-syntax',
      );
    }
  });

  it('forbids casting to PoolContext anywhere except the factory', async () => {
    expect(await ruleIds(cast, 'packages/services/src/guards.ts')).toContain(
      'no-restricted-syntax',
    );
    expect(await ruleIds(cast, 'apps/web/src/app/page.ts')).toContain('no-restricted-syntax');
    expect(await ruleIds(cast, 'tests/db/harness.ts')).toContain('no-restricted-syntax');
    expect(await ruleIds(cast, 'packages/db/src/pool-context.factory.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });
});

describe('the database package in the web app', () => {
  const dbImport = "import { withPool } from '@nestvault/db';\nexport const w = withPool;\n";

  it('is blocked in apps/web and allowed in services and the worker', async () => {
    expect(await ruleIds(dbImport, 'apps/web/src/app/page.ts')).toContain('no-restricted-imports');
    expect(await ruleIds(dbImport, 'packages/services/src/x.ts')).not.toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(dbImport, 'apps/worker/src/index.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('Node-only config entry', () => {
  const nodeImport =
    "import { runtimeEnv } from '@nestvault/config/node';\nexport const e = runtimeEnv;\n";

  it('is blocked in apps/web (it must not reach the browser) and allowed elsewhere', async () => {
    expect(await ruleIds(nodeImport, 'apps/web/src/app/page.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(nodeImport, 'packages/db/src/app/with-pool.ts')).not.toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(nodeImport, 'apps/worker/src/index.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('conditional JSX', () => {
  const ternary = 'export const a = (x: boolean) => <div>{x ? <b /> : null}</div>;\n';
  const and = 'export const a = (x: boolean) => <div>{x && <b />}</div>;\n';
  const other = 'export const a = (x: boolean) => <div>{x ? <b /> : <i />}</div>;\n';
  const file = 'apps/web/src/components/x.tsx';

  it('rejects `cond ? <X /> : null` and accepts `&&` and a ternary with two elements', async () => {
    expect(await ruleIds(ternary, file)).toContain('no-restricted-syntax');
    expect(await ruleIds(and, file)).not.toContain('no-restricted-syntax');
    expect(await ruleIds(other, file)).not.toContain('no-restricted-syntax');
  });

  it('applies to packages/ui as well', async () => {
    expect(await ruleIds(ternary, 'packages/ui/src/components/x.tsx')).toContain(
      'no-restricted-syntax',
    );
  });
});

describe('services in client components', () => {
  const root =
    "import { safeNextPath } from '@nestvault/services';\nexport const x = safeNextPath;\n";
  const subpath =
    "import { isCommonPassword } from '@nestvault/services/password-policy';\nexport const x = isCommonPassword;\n";

  it('is blocked from the services root in components and allowed for the pure subpath', async () => {
    expect(await ruleIds(root, 'apps/web/src/components/auth/x.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds(subpath, 'apps/web/src/components/auth/x.ts')).not.toContain(
      'no-restricted-imports',
    );
  });

  it('is still allowed on the server side of the web app', async () => {
    expect(await ruleIds(root, 'apps/web/src/lib/auth-redirect.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('role comparisons (architecture rule 5)', () => {
  const memberRole = "export const isOwner = (m: { role: string }) => m.role === 'owner';\n";
  const bareRole = "export const isAdmin = (role: string) => role !== 'admin';\n";
  const switched =
    "export function f(m: { role: string }) {\n  switch (m.role) {\n    case 'owner':\n      return 1;\n    default:\n      return 0;\n  }\n}\n";

  it('fails in services, the web app and tests: ask can(ctx, permission) instead', async () => {
    for (const code of [memberRole, bareRole, switched]) {
      for (const path of [
        'packages/services/src/x.ts',
        'apps/web/src/server/x.ts',
        'tests/services/x.test.ts',
      ]) {
        expect(await ruleIds(code, path), path).toContain('no-restricted-syntax');
      }
    }
  });

  it('is allowed in the context factory, which validates the role it is given', async () => {
    expect(await ruleIds(memberRole, 'packages/db/src/pool-context.factory.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });

  it('does not flag other comparisons', async () => {
    const other = "export const same = (a: { name: string }) => a.name === 'owner';\n";
    expect(await ruleIds(other, 'packages/services/src/x.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });
});
