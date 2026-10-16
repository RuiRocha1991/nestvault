import { z } from 'zod';

// Schema types with no children: nothing inside can hide an extra key.
const LEAF_TYPES = new Set([
  'string',
  'number',
  'int',
  'boolean',
  'bigint',
  'date',
  'enum',
  'literal',
  'null',
  'undefined',
  'void',
  'nan',
  'symbol',
  'any',
  'unknown',
  'never',
  'template_literal',
  'file',
  'custom',
  // A transform produces the output; the input side of its pipe is what gets closed.
  'transform',
]);

interface Def {
  type: string;
  [key: string]: unknown;
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/**
 * The same schema with every object closed, recursively. A DTO schema strips unknown keys when it
 * parses, so a response that leaks an extra field (`poolId`, a token hash, a raw row column) would
 * still "match" it; the strict copy fails on that field instead. It follows arrays, tuples,
 * records, unions, optional/nullable/default/readonly wrappers and pipes (a `.transform()` closes
 * its input). A schema type it cannot close throws, so a DTO never passes unchecked by accident.
 */
export function strictly(schema: z.ZodType): z.ZodType {
  const def = defOf(schema);
  const inner = () => strictly(def.innerType as z.ZodType);

  switch (def.type) {
    case 'object': {
      const shape = (schema as z.ZodObject).shape as Record<string, z.ZodType>;
      return z.strictObject(
        Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, strictly(value)])),
      );
    }
    case 'array':
      return z.array(strictly(def.element as z.ZodType));
    case 'tuple': {
      const items = (def.items as z.ZodType[]).map(strictly) as [z.ZodType, ...z.ZodType[]];
      return def.rest ? z.tuple(items, strictly(def.rest as z.ZodType)) : z.tuple(items);
    }
    case 'record':
      return z.record(def.keyType as z.ZodString, strictly(def.valueType as z.ZodType));
    case 'union':
      return z.union((def.options as z.ZodType[]).map(strictly) as [z.ZodType, z.ZodType]);
    case 'nullable':
      return inner().nullable();
    case 'optional':
      return inner().optional();
    case 'default':
      return inner().default(def.defaultValue as never);
    case 'readonly':
      return inner().readonly();
    case 'pipe':
      return z.pipe(strictly(def.in as z.ZodType), strictly(def.out as z.ZodType));
    default:
      if (LEAF_TYPES.has(def.type)) return schema;
      throw new Error(
        `strictly() cannot close a "${def.type}" schema: add it to tests/support/strict-schema.ts, or the DTO would be checked less strictly than it looks`,
      );
  }
}

/** The one error shape `route()` answers with (no stack, no SQL, no cause). */
export const ErrorEnvelope = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    issues: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
  }),
  requestId: z.string().min(1),
});
