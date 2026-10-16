import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// What exists on disk under `app/api/v1`, read without importing any route: the static half of the
// "every Route Handler is in the isolation registry" check (docs/testing.md).

export const API_ROOT = resolve(import.meta.dirname, '../../apps/web/src/app/api/v1');

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface HandlerOnDisk {
  /** `METHOD /api/v1/pools/:poolId/members`: the key the registry uses too. */
  key: string;
  method: HttpMethod;
  /** Folder of the route below `app/api/v1`, e.g. `pools/[poolId]/members`. */
  dir: string;
  path: string;
}

/** `[poolId]` becomes `:poolId` and a catch-all `[...all]` becomes `*`. */
export function pathOfDir(dir: string): string {
  const segments = dir
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (catchAll) return '*';
      const dynamic = /^\[(.+)\]$/.exec(segment);
      return dynamic ? `:${dynamic[1] ?? ''}` : segment;
    });
  return `/api/v1${segments.length > 0 ? `/${segments.join('/')}` : ''}`;
}

/** The HTTP methods a `route.ts` exports (`export const GET`, `export async function POST`, `export { GET }`). */
export function exportedMethods(source: string): HttpMethod[] {
  const names = HTTP_METHODS.join('|');
  const declared = new RegExp(
    `export\\s+(?:const|let|async\\s+function|function)\\s+(${names})\\b`,
    'g',
  );
  const listed = /export\s*\{([^}]*)\}/g;
  const found = new Set<HttpMethod>();
  for (const match of source.matchAll(declared)) found.add(match[1] as HttpMethod);
  for (const match of source.matchAll(listed)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name =
        part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? '';
      if ((HTTP_METHODS as readonly string[]).includes(name)) found.add(name as HttpMethod);
    }
  }
  return HTTP_METHODS.filter((method) => found.has(method));
}

interface RouteFile {
  /** Folder of the route below `app/api/v1`. */
  dir: string;
  source: string;
}

function routeFiles(root: string): RouteFile[] {
  const files: RouteFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const relative = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name === 'route.ts') {
        files.push({ dir, source: readFileSync(join(root, relative), 'utf8') });
      }
    }
  };
  walk('');
  return files;
}

/** Every `route.ts` below `root` with the methods it exports. */
export function listHandlers(root = API_ROOT): HandlerOnDisk[] {
  const handlers: HandlerOnDisk[] = [];
  for (const { dir, source } of routeFiles(root)) {
    const path = pathOfDir(dir);
    for (const method of exportedMethods(source)) {
      handlers.push({ key: `${method} ${path}`, method, dir, path });
    }
  }
  return handlers.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Re-exports the regex reading above cannot follow: the handlers they bring in would be invisible
 * to the registry check. A `route.ts` must declare its handlers itself.
 */
export function unsupportedReexports(source: string): string[] {
  const forms: Array<[string, RegExp]> = [
    ['export * from', /export\s*\*\s*(?:as\s+\w+\s*)?from\s/],
    ['export { … } from', /export\s*(?:type\s*)?\{[^}]*\}\s*from\s/],
  ];
  return forms.filter(([, pattern]) => pattern.test(source)).map(([form]) => form);
}

/** `route.ts` files that use a re-export form the detection cannot see through. */
export function routesWithUnsupportedReexports(root = API_ROOT): string[] {
  return routeFiles(root).flatMap(({ dir, source }) =>
    unsupportedReexports(source).map((form) => `${dir}/route.ts uses "${form}"`),
  );
}

/** Handlers on disk that the registry does not mention, and registry entries without a handler. */
export function compareWithRegistry(
  onDisk: readonly Pick<HandlerOnDisk, 'key'>[],
  registered: readonly string[],
): { unregistered: string[]; stale: string[] } {
  const disk = new Set(onDisk.map((handler) => handler.key));
  const known = new Set(registered);
  return {
    unregistered: [...disk].filter((key) => !known.has(key)).sort(),
    stale: [...known].filter((key) => !disk.has(key)).sort(),
  };
}
