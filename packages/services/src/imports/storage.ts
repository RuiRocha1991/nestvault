import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decrypt, encrypt, type KeyRing } from '@nestvault/crypto';

import { NotFoundError } from '../errors';

// Uploaded statements at rest (security control 14): encrypted with AES-256-GCM, named by the
// SHA-256 of their content, under a directory that is not served by the web server. One folder per
// pool so two households never share a file. The name and the pool are authenticated with the data,
// so a file copied under another name does not decrypt. Swap this adapter for S3/R2 later; the
// interface stays.

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface FileStore {
  put(poolId: string, sha256: string, bytes: Uint8Array): Promise<void>;
  /** `NotFoundError` when there is no such file. Fails if the key it was written with is gone. */
  get(poolId: string, sha256: string): Promise<Buffer>;
}

export interface FileStoreOptions {
  /** Absolute path of a directory outside the web root. */
  dir: string;
  ring: KeyRing;
}

function locate(dir: string, poolId: string, sha256: string): { folder: string; file: string } {
  // Ids reach the file system, so they are checked here as well as where they come from.
  if (!UUID.test(poolId) || !SHA256.test(sha256)) throw new NotFoundError();
  const folder = join(dir, poolId);
  return { folder, file: join(folder, `${sha256}.bin`) };
}

/**
 * Deletes a stored statement (if it is there). The worker uses it for discarded previews. A file
 * written within `minAgeMs` is kept: an upload of the same statement writes the file (`put`
 * replaces it, with a fresh modification time) a moment before it records its batch, and that
 * window must not lose the file. Returns whether a file was removed.
 */
export async function removeStoredFile(
  dir: string,
  poolId: string,
  sha256: string,
  options: { minAgeMs?: number; now?: () => number } = {},
): Promise<boolean> {
  const { file } = locate(dir, poolId, sha256);
  if (options.minAgeMs) {
    try {
      const { mtimeMs } = await stat(file);
      if ((options.now ?? Date.now)() - mtimeMs < options.minAgeMs) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  await rm(file, { force: true });
  return true;
}

export function createEncryptedFileStore({ dir, ring }: FileStoreOptions): FileStore {
  return {
    async put(poolId, sha256, bytes) {
      const { folder, file } = locate(dir, poolId, sha256);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      // Write beside the target and rename, so a crash never leaves half a file under the real name.
      const temporary = join(folder, `.${sha256}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, encrypt(ring, bytes, `${poolId}/${sha256}`), { mode: 0o600 });
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },

    async get(poolId, sha256) {
      const { file } = locate(dir, poolId, sha256);
      let blob: Buffer;
      try {
        blob = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError();
        throw error;
      }
      return decrypt(ring, blob, `${poolId}/${sha256}`);
    },
  };
}
