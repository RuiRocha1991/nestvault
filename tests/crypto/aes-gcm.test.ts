import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CryptoError,
  decrypt,
  encrypt,
  isEncryptedWith,
  keyIdOf,
  parseKeyRing,
  rotate,
} from '@nestvault/crypto';

const key = () => randomBytes(32).toString('base64');

describe('parseKeyRing', () => {
  it('reads one plain key as k1', () => {
    const ring = parseKeyRing(key());
    expect(ring.activeId).toBe('k1');
    expect([...ring.keys.keys()]).toEqual(['k1']);
  });

  it('reads a list: the first entry is the active key', () => {
    const ring = parseKeyRing(`new:${key()}, old:${key()}`);
    expect(ring.activeId).toBe('new');
    expect([...ring.keys.keys()]).toEqual(['new', 'old']);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  ,  '],
    ['not base64', 'not base64!!'],
    ['too short', Buffer.alloc(16).toString('base64')],
    ['too long', Buffer.alloc(33).toString('base64')],
    ['bad id', `bad id:${key()}`],
    ['id too long', `${'x'.repeat(17)}:${key()}`],
    ['empty id', `:${key()}`],
    ['repeated id', `a:${key()},a:${key()}`],
    ['too many', Array.from({ length: 9 }, (_, i) => `k${i}:${key()}`).join(',')],
  ])('refuses %s', (_name, value) => {
    expect(() => parseKeyRing(value)).toThrow(CryptoError);
  });

  it('never puts key material in its error', () => {
    const material = Buffer.alloc(16, 7).toString('base64');
    expect(() => parseKeyRing(material)).toThrow(/not 32 bytes/);
    try {
      parseKeyRing(material);
    } catch (error) {
      expect(String(error)).not.toContain(material);
    }
  });
});

describe('encrypt / decrypt', () => {
  const ring = parseKeyRing(key());

  it('round-trips bytes of any size, including none', () => {
    for (const size of [0, 1, 15, 16, 17, 100_000]) {
      const plain = randomBytes(size);
      expect(decrypt(ring, encrypt(ring, plain)).equals(plain)).toBe(true);
    }
  });

  it('does not leave the plaintext readable', () => {
    const plain = Buffer.from('IBAN PT50 0000 0000 0000 0000 0000 0 salary 1500,00');
    const blob = encrypt(ring, plain);
    expect(blob.includes(plain.subarray(0, 12))).toBe(false);
    expect(blob.includes(Buffer.from('salary'))).toBe(false);
  });

  it('uses a new iv every time', () => {
    const plain = Buffer.from('same');
    expect(encrypt(ring, plain).equals(encrypt(ring, plain))).toBe(false);
  });

  it('refuses any changed byte (header, iv, body, tag)', () => {
    const blob = encrypt(ring, Buffer.from('statement'));
    for (let at = 0; at < blob.length; at += 1) {
      const copy = Buffer.from(blob);
      copy[at] = (copy[at] ?? 0) ^ 0x01;
      expect(() => decrypt(ring, copy), `byte ${at}`).toThrow(CryptoError);
    }
  });

  it('refuses a truncated blob and non-blobs', () => {
    const blob = encrypt(ring, Buffer.from('statement'));
    expect(() => decrypt(ring, blob.subarray(0, blob.length - 1))).toThrow(CryptoError);
    expect(() => decrypt(ring, Buffer.alloc(0))).toThrow(CryptoError);
    expect(() => decrypt(ring, Buffer.from('plain text file'))).toThrow(CryptoError);
    expect(() => keyIdOf(Buffer.from([2, 2, 1, 1]))).toThrow(CryptoError);
  });

  it('is bound to its context: a file swapped under another name fails', () => {
    const blob = encrypt(ring, Buffer.from('statement'), 'sha-a');
    expect(decrypt(ring, blob, 'sha-a').toString()).toBe('statement');
    expect(() => decrypt(ring, blob, 'sha-b')).toThrow(CryptoError);
    expect(() => decrypt(ring, blob)).toThrow(CryptoError);
  });

  it('cannot be read with another key', () => {
    const blob = encrypt(ring, Buffer.from('statement'));
    const other = parseKeyRing(`k1:${key()}`);
    expect(() => decrypt(other, blob)).toThrow(CryptoError);
  });
});

describe('key rotation', () => {
  const oldKey = key();
  const newKey = key();

  it('reads data written under a retired key and writes under the new one', () => {
    const before = parseKeyRing(`old:${oldKey}`);
    const blob = encrypt(before, Buffer.from('statement'), 'ctx');
    expect(keyIdOf(blob)).toBe('old');

    const during = parseKeyRing(`new:${newKey},old:${oldKey}`);
    expect(decrypt(during, blob, 'ctx').toString()).toBe('statement');
    expect(isEncryptedWith(during, blob)).toBe(false);

    const rotated = rotate(during, blob, 'ctx');
    expect(keyIdOf(rotated)).toBe('new');
    expect(isEncryptedWith(during, rotated)).toBe(true);
    expect(decrypt(during, rotated, 'ctx').toString()).toBe('statement');

    const after = parseKeyRing(`new:${newKey}`);
    expect(decrypt(after, rotated, 'ctx').toString()).toBe('statement');
    expect(() => decrypt(after, blob, 'ctx')).toThrow(/is gone/);
  });

  it('leaves blobs that are already current untouched', () => {
    const ring = parseKeyRing(`new:${newKey}`);
    const blob = encrypt(ring, Buffer.from('x'));
    expect(rotate(ring, blob).equals(blob)).toBe(true);
  });

  it('does not let a changed key id decrypt with a different key', () => {
    const ring = parseKeyRing(`a:${oldKey},b:${newKey}`);
    const blob = encrypt(ring, Buffer.from('statement'));
    const forged = Buffer.from(blob);
    forged[2] = 'b'.charCodeAt(0); // header says key b, data was written with key a
    expect(() => decrypt(ring, forged)).toThrow(CryptoError);
  });
});
