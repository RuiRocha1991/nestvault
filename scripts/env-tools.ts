// Compares .env.local with .env.example and adds what is missing. Everything here works on the
// variable NAMES and never prints a value: values may be secrets.
import { randomBytes } from 'node:crypto';

const VERSION_LINE = /^#\s*env-version:\s*(\d+)\s*$/m;
const PLACEHOLDER = /__([A-Z0-9_]+)__/g;

export interface ParsedEnv {
  /** The `# env-version: N` marker, or null when the file has none (created before versions). */
  version: number | null;
  /** KEY -> raw value, in file order. */
  values: Map<string, string>;
}

export function parseEnv(text: string): ParsedEnv {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1));
  }
  const match = VERSION_LINE.exec(text);
  return { version: match?.[1] ? Number(match[1]) : null, values };
}

export interface EnvDiff {
  exampleVersion: number | null;
  localVersion: number | null;
  /** In .env.example but not in .env.local. */
  missing: string[];
  /** In .env.local but not in .env.example (renamed or removed variables). */
  unknown: string[];
}

export function diffEnv(exampleText: string, localText: string): EnvDiff {
  const example = parseEnv(exampleText);
  const local = parseEnv(localText);
  return {
    exampleVersion: example.version,
    localVersion: local.version,
    missing: [...example.values.keys()].filter((key) => !local.values.has(key)),
    unknown: [...local.values.keys()].filter((key) => !example.values.has(key)),
  };
}

export type RandomValue = (placeholder: string) => string;

/** Same values `pnpm env:init` produces: hex for passwords, base64 for secrets, port 5433. */
export const randomPlaceholder: RandomValue = (name) => {
  if (name === 'POSTGRES_PORT') return '5433';
  if (name === 'BETTER_AUTH_SECRET' || name === 'APP_ENCRYPTION_KEY') {
    return randomBytes(32).toString('base64');
  }
  return randomBytes(24).toString('hex');
};

export interface SyncResult {
  text: string;
  /** Names of the variables that were added. */
  added: string[];
}

/**
 * Appends the variables that .env.local lacks, filling placeholders. A placeholder takes the value
 * the existing file already has for that name (so a new URL keeps using the current database
 * password) and is generated only when there is none. Existing values are never changed.
 */
export function syncEnv(
  exampleText: string,
  localText: string,
  random: RandomValue = randomPlaceholder,
): SyncResult {
  const example = parseEnv(exampleText);
  const local = parseEnv(localText);
  const generated = new Map<string, string>();
  const valueFor = (name: string) => {
    const known = local.values.get(name);
    if (known !== undefined) return known;
    if (!generated.has(name)) generated.set(name, random(name));
    return generated.get(name) ?? '';
  };

  const added: string[] = [];
  const lines: string[] = [];
  for (const [key, raw] of example.values) {
    if (local.values.has(key)) continue;
    added.push(key);
    lines.push(`${key}=${raw.replace(PLACEHOLDER, (_m, name: string) => valueFor(name))}`);
  }

  let text = localText;
  if (added.length > 0) {
    const stamp = example.version === null ? '' : ` (env-version ${example.version})`;
    text = `${text.replace(/\n*$/, '\n')}\n# --- Added by pnpm env:sync${stamp} ---\n${lines.join('\n')}\n`;
  }
  if (example.version !== null) {
    text = VERSION_LINE.test(text)
      ? text.replace(VERSION_LINE, `# env-version: ${example.version}`)
      : `# env-version: ${example.version}\n${text}`;
  }
  return { text, added };
}

/** Human-readable report; names only. */
export function describeDiff(diff: EnvDiff): string[] {
  const lines: string[] = [];
  const shown = (version: number | null) => (version === null ? 'none' : String(version));
  lines.push(
    `.env.example is version ${shown(diff.exampleVersion)}; your .env.local is version ${shown(diff.localVersion)}.`,
  );
  if (diff.missing.length > 0) {
    lines.push(`Missing from .env.local (${diff.missing.length}):`);
    lines.push(...diff.missing.map((key) => `  - ${key}`));
    lines.push('Run `pnpm env:sync` to add them (existing values are not touched).');
  } else {
    lines.push('Every variable of .env.example is in .env.local.');
  }
  if (diff.unknown.length > 0) {
    lines.push(`Not in .env.example any more (renamed or removed?): ${diff.unknown.join(', ')}`);
  }
  return lines;
}
