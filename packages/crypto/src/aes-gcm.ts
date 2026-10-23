import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for data at rest (uploaded statements). The blob is self-describing so a key can be
// rotated without a migration:
//
//   [format 1 byte = 1][key id length 1 byte][key id][iv 12 bytes][ciphertext][auth tag 16 bytes]
//
// The header (format, key id) and an optional caller context are authenticated: swapping a file for
// another one, or editing the key id, makes decryption fail instead of returning wrong data.

const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_KEYS = 8;
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_KEY_ID = 'k1';

/** Never carries key material or file content. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export interface KeyRing {
  /** The key new data is encrypted with. */
  readonly activeId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

/**
 * Reads `APP_ENCRYPTION_KEY`. One key is `base64` (id `k1`); several are comma-separated
 * `id:base64` entries and the first one is the active key, so rotating is: put the new key first
 * and keep the old ones until everything is re-encrypted (`rotate`).
 */
export function parseKeyRing(value: string): KeyRing {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new CryptoError('No encryption key is configured.');
  if (entries.length > MAX_KEYS) throw new CryptoError('Too many encryption keys.');
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const colon = entry.indexOf(':');
    const id = colon === -1 ? DEFAULT_KEY_ID : entry.slice(0, colon);
    const material = colon === -1 ? entry : entry.slice(colon + 1);
    if (!KEY_ID.test(id)) throw new CryptoError('An encryption key id is not valid.');
    if (!BASE64.test(material)) throw new CryptoError('An encryption key is not valid.');
    const key = Buffer.from(material, 'base64');
    if (key.length !== KEY_BYTES) throw new CryptoError('An encryption key is not 32 bytes.');
    if (keys.has(id)) throw new CryptoError('An encryption key id is repeated.');
    keys.set(id, key);
  }
  const [activeId] = keys.keys();
  if (activeId === undefined) throw new CryptoError('No encryption key is configured.');
  return { activeId, keys };
}

const bytesOf = (data: Uint8Array | string) =>
  typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);

const header = (keyId: string): Buffer => {
  const id = Buffer.from(keyId, 'ascii');
  return Buffer.concat([Buffer.from([FORMAT, id.length]), id]);
};

/** `context` is authenticated but not stored: pass the same value to `decrypt`. */
export function encrypt(ring: KeyRing, plaintext: Uint8Array, context = ''): Buffer {
  const key = ring.keys.get(ring.activeId);
  if (key === undefined) throw new CryptoError('The active encryption key is missing.');
  const head = header(ring.activeId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([head, bytesOf(context)]));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([head, iv, body, cipher.getAuthTag()]);
}

interface Parsed {
  keyId: string;
  head: Buffer;
  iv: Buffer;
  body: Buffer;
  tag: Buffer;
}

function parse(blob: Uint8Array): Parsed {
  const data = Buffer.from(blob);
  if (data.length < 2 || data[0] !== FORMAT) throw new CryptoError('Not an encrypted blob.');
  const idLength = data[1] ?? 0;
  const bodyStart = 2 + idLength + IV_BYTES;
  if (idLength === 0 || data.length < bodyStart + TAG_BYTES) {
    throw new CryptoError('Not an encrypted blob.');
  }
  return {
    keyId: data.subarray(2, 2 + idLength).toString('ascii'),
    head: data.subarray(0, 2 + idLength),
    iv: data.subarray(2 + idLength, bodyStart),
    body: data.subarray(bodyStart, data.length - TAG_BYTES),
    tag: data.subarray(data.length - TAG_BYTES),
  };
}

/** The id of the key a blob was encrypted with (read from the unauthenticated header). */
export function keyIdOf(blob: Uint8Array): string {
  return parse(blob).keyId;
}

export function isEncryptedWith(ring: KeyRing, blob: Uint8Array): boolean {
  return keyIdOf(blob) === ring.activeId;
}

/** Fails with `CryptoError` for a wrong key, a changed byte or another context. */
export function decrypt(ring: KeyRing, blob: Uint8Array, context = ''): Buffer {
  const { keyId, head, iv, body, tag } = parse(blob);
  const key = ring.keys.get(keyId);
  if (key === undefined) throw new CryptoError('The key this data was encrypted with is gone.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.concat([head, bytesOf(context)]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new CryptoError('The data could not be decrypted.');
  }
}

/** Re-encrypts with the active key; blobs already under it are returned unchanged. */
export function rotate(ring: KeyRing, blob: Uint8Array, context = ''): Buffer {
  return isEncryptedWith(ring, blob)
    ? Buffer.from(blob)
    : encrypt(ring, decrypt(ring, blob, context), context);
}
