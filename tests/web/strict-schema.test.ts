import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { strictly } from '../support/strict-schema';

// `strictly()` is what makes "the response has nothing extra" true (security control 17), so each
// wrapper a DTO may use is proven to keep closing the objects inside it.

const Inner = z.object({ id: z.string() });

describe('strictly()', () => {
  const wrappers: Array<[string, z.ZodType, unknown, unknown]> = [
    ['an object', Inner, { id: 'a' }, { id: 'a', extra: 1 }],
    ['an array', z.array(Inner), [{ id: 'a' }], [{ id: 'a', extra: 1 }]],
    ['a nullable', Inner.nullable(), { id: 'a' }, { id: 'a', extra: 1 }],
    [
      'an optional',
      z.object({ x: Inner.optional() }),
      { x: { id: 'a' } },
      { x: { id: 'a', extra: 1 } },
    ],
    [
      'a default',
      z.object({ x: Inner.default({ id: 'd' }) }),
      { x: { id: 'a' } },
      { x: { id: 'a', extra: 1 } },
    ],
    ['a readonly', Inner.readonly(), { id: 'a' }, { id: 'a', extra: 1 }],
    [
      'a pipe into a transform',
      Inner.transform((value) => ({ ...value })),
      { id: 'a' },
      { id: 'a', extra: 1 },
    ],
    [
      'a pipe between two objects',
      Inner.pipe(z.object({ id: z.string() })),
      { id: 'a' },
      { id: 'a', extra: 1 },
    ],
    ['a union', z.union([Inner, z.object({ n: z.number() })]), { id: 'a' }, { id: 'a', extra: 1 }],
    [
      'a discriminated union',
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), id: z.string() }),
        z.object({ kind: z.literal('b'), n: z.number() }),
      ]),
      { kind: 'a', id: 'x' },
      { kind: 'a', id: 'x', extra: 1 },
    ],
    ['a record', z.record(z.string(), Inner), { k: { id: 'a' } }, { k: { id: 'a', extra: 1 } }],
    ['a tuple', z.tuple([Inner, z.string()]), [{ id: 'a' }, 's'], [{ id: 'a', extra: 1 }, 's']],
    [
      'a tuple rest',
      z.tuple([z.string()], Inner),
      ['s', { id: 'a' }],
      ['s', { id: 'a', extra: 1 }],
    ],
    [
      'wrappers stacked deep',
      z.object({ list: z.array(z.object({ x: Inner.nullable().optional() })).readonly() }),
      { list: [{ x: { id: 'a' } }, {}] },
      { list: [{ x: { id: 'a', extra: 1 } }] },
    ],
  ];

  it.each(wrappers)('closes the objects inside %s', (_name, schema, valid, withExtra) => {
    expect(schema.safeParse(withExtra).success, 'the plain schema strips the extra key').toBe(true);
    expect(strictly(schema).safeParse(valid).success).toBe(true);
    expect(strictly(schema).safeParse(withExtra).success).toBe(false);
  });

  it('keeps the values of leaves, defaults and transforms', () => {
    const schema = z.object({ n: z.number().int(), s: z.enum(['a', 'b']).default('a') });
    expect(strictly(schema).parse({ n: 1 })).toEqual({ n: 1, s: 'a' });
    expect(strictly(Inner.transform((v) => v.id)).parse({ id: 'x' })).toBe('x');
  });

  it('throws a clear error for a schema it cannot close instead of passing it unchecked', () => {
    const lazy = z.lazy(() => Inner);
    expect(() => strictly(lazy)).toThrow(/cannot close a "lazy" schema/);
    expect(() => strictly(z.object({ deep: z.array(lazy) }))).toThrow(/cannot close/);
    expect(() => strictly(z.intersection(Inner, z.object({ n: z.number() })))).toThrow(
      /cannot close a "intersection" schema/,
    );
  });
});
