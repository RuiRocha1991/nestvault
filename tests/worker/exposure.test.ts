import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB_SRC = resolve(import.meta.dirname, '../../apps/web/src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('job runs are operational, not a user feature', () => {
  it('no page, action or route of the web app reads the queue schema or imports the worker', () => {
    const offenders = sourceFiles(WEB_SRC).filter((file) =>
      /pgboss|pg-boss|@nestvault\/worker/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('the web app has no worker or runs route', () => {
    const routes = sourceFiles(join(WEB_SRC, 'app')).filter((file) =>
      /(^|[\\/])(worker|jobs|runs)([\\/]|$)/i.test(file.slice(WEB_SRC.length)),
    );
    expect(routes).toEqual([]);
  });
});
