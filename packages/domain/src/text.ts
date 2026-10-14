import { createHash } from 'node:crypto';

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Matching key for names, descriptions and keywords: no accents, upper case, single spaces. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SHA-256 hex of the text, for import de-duplication. It replaces the prototype's 32-bit `hashStr`,
 * so hashes of data imported by the prototype do not match and must be recomputed on migration.
 */
export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
