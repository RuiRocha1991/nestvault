import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CryptoError, encrypt, parseKeyRing } from '@nestvault/crypto';
import { createEncryptedFileStore, NotFoundError, removeStoredFile } from '@nestvault/services';

const POOL = '0198f000-0000-7000-8000-000000000001';
const OTHER_POOL = '0198f000-0000-7000-8000-000000000002';
const SHA = 'ab'.repeat(32);
const key = () => randomBytes(32).toString('base64');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nv-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('encrypted file store', () => {
  it('round-trips a file and names it by its hash', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    const bytes = Buffer.from('Data;Descrição;Valor\n01-01-2026;Salário;1500,00\n');
    await store.put(POOL, SHA, bytes);
    expect(await readdir(join(dir, POOL))).toEqual([`${SHA}.bin`]);
    expect((await store.get(POOL, SHA)).equals(bytes)).toBe(true);
  });

  it('does not keep the content readable on disk', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await store.put(POOL, SHA, Buffer.from('IBAN PT50000000000000000000000 Salário 1500,00'));
    const onDisk = await readFile(join(dir, POOL, `${SHA}.bin`));
    expect(onDisk.includes(Buffer.from('Salário'))).toBe(false);
    expect(onDisk.includes(Buffer.from('PT50'))).toBe(false);
  });

  it('cannot be read without the key', async () => {
    const writer = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await writer.put(POOL, SHA, Buffer.from('statement'));
    const stranger = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await expect(stranger.get(POOL, SHA)).rejects.toBeInstanceOf(CryptoError);
  });

  it('survives a key rotation: the old file reads with the new ring', async () => {
    const oldKey = key();
    const newKey = key();
    await createEncryptedFileStore({ dir, ring: parseKeyRing(`old:${oldKey}`) }).put(
      POOL,
      SHA,
      Buffer.from('statement'),
    );
    const rotated = createEncryptedFileStore({
      dir,
      ring: parseKeyRing(`new:${newKey},old:${oldKey}`),
    });
    expect((await rotated.get(POOL, SHA)).toString()).toBe('statement');
    const withoutOld = createEncryptedFileStore({ dir, ring: parseKeyRing(`new:${newKey}`) });
    await expect(withoutOld.get(POOL, SHA)).rejects.toBeInstanceOf(CryptoError);
  });

  it('refuses a file copied under another name or into another pool', async () => {
    const ring = parseKeyRing(key());
    const store = createEncryptedFileStore({ dir, ring });
    await store.put(POOL, SHA, Buffer.from('statement'));
    const copy = await readFile(join(dir, POOL, `${SHA}.bin`));
    const otherSha = 'cd'.repeat(32);
    await store.put(OTHER_POOL, 'ef'.repeat(32), Buffer.from('x')); // creates the folder
    await writeFile(join(dir, OTHER_POOL, `${otherSha}.bin`), copy);
    await expect(store.get(OTHER_POOL, otherSha)).rejects.toBeInstanceOf(CryptoError);
  });

  it('refuses a tampered file', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await store.put(POOL, SHA, Buffer.from('statement'));
    const file = join(dir, POOL, `${SHA}.bin`);
    const blob = await readFile(file);
    blob[blob.length - 20] = (blob[blob.length - 20] ?? 0) ^ 0xff;
    await writeFile(file, blob);
    await expect(store.get(POOL, SHA)).rejects.toBeInstanceOf(CryptoError);
  });

  it('reports a missing file as not found', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await expect(store.get(POOL, SHA)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never lets an id reach the file system as a path', async () => {
    const ring = parseKeyRing(key());
    const store = createEncryptedFileStore({ dir, ring });
    for (const [pool, sha] of [
      ['../escape', SHA],
      [POOL, '../../etc/passwd'],
      [POOL, 'AB'.repeat(32)],
      [POOL, 'ab'.repeat(31)],
      ['', SHA],
    ] as const) {
      await expect(store.put(pool, sha, Buffer.from('x'))).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.get(pool, sha)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('writes with private permissions and leaves no temporary file', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await store.put(POOL, SHA, Buffer.from('statement'));
    expect((await stat(join(dir, POOL, `${SHA}.bin`))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, POOL))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(dir, POOL))).toEqual([`${SHA}.bin`]);
  });

  it('replacing a file with the same content keeps it readable', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await store.put(POOL, SHA, Buffer.from('statement'));
    await store.put(POOL, SHA, Buffer.from('statement'));
    expect((await store.get(POOL, SHA)).toString()).toBe('statement');
  });

  it('is bound to the key ring it was written with, even for a hand-made blob', async () => {
    const ring = parseKeyRing(key());
    const store = createEncryptedFileStore({ dir, ring });
    await store.put(POOL, SHA, Buffer.from('statement')); // creates the folder
    await writeFile(join(dir, POOL, `${SHA}.bin`), encrypt(ring, Buffer.from('forged'), 'other'));
    await expect(store.get(POOL, SHA)).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('removeStoredFile', () => {
  it('deletes one file, ignores a missing one and refuses a path-like hash', async () => {
    const store = createEncryptedFileStore({ dir, ring: parseKeyRing(key()) });
    await store.put(POOL, SHA, Buffer.from('x'));
    await removeStoredFile(dir, POOL, SHA);
    expect(await readdir(join(dir, POOL))).toEqual([]);
    await removeStoredFile(dir, POOL, SHA);
    await expect(removeStoredFile(dir, POOL, '../../etc/passwd')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
