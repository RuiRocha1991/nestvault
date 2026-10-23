import { z } from 'zod';

import {
  UnprocessableError,
  UnsupportedMediaTypeError,
  UpstreamError,
  ValidationError,
} from '../errors';
import { logger } from '../logger';

import { parserResponseSchema, type ParserResponseSchema } from './parser-rows.generated';

// The client of the internal parser service (services/parser, ADR 0001). It sends the file bytes
// with the shared secret and validates every answer with the schema generated from the parser's own
// models, so a buggy or compromised parser can never put an unexpected shape into the pipeline.
// Parser errors reach the user as generic messages; the parser's text is never forwarded.

export type ParserResponse = ParserResponseSchema;

const candidateSchema = z
  .object({
    parser_id: z.string().max(64),
    kind: z.enum(['bank', 'broker']),
    version: z.string().max(40),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ParserCandidate = z.infer<typeof candidateSchema>;

const detectSchema = z.object({ results: z.array(candidateSchema).max(50) }).strict();

/** An import spec as the parser writes it (its own strict schema validates it on every use). */
export const SPEC_MAX_BYTES = 8 * 1024;
const specSchema = z
  .record(z.string(), z.unknown())
  .refine((spec) => JSON.stringify(spec).length <= SPEC_MAX_BYTES, 'The mapping is too large.');
export type ImportSpecJson = z.infer<typeof specSchema>;
export const importSpecSchema = specSchema;

const proposalSchema = z
  .object({
    spec: specSchema,
    header: z.array(z.string().max(100)).max(200),
    preview: parserResponseSchema,
  })
  .strict();
export type MappingProposal = z.infer<typeof proposalSchema>;

const errorSchema = z.object({ code: z.string().max(64) });

export interface ParserClient {
  detect(data: Uint8Array): Promise<ParserCandidate[]>;
  parse(data: Uint8Array, parserId: string): Promise<ParserResponse>;
  /** A guessed column mapping for a csv no parser recognised. */
  propose(data: Uint8Array): Promise<MappingProposal>;
  /** Parse with a mapping the user confirmed. */
  parseWithSpec(data: Uint8Array, spec: ImportSpecJson): Promise<ParserResponse>;
}

export interface ParserClientOptions {
  /** Base URL (`PARSER_URL`). */
  url: string;
  /** `PARSER_SECRET`, sent as `X-Parser-Secret`. */
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** The parser's refusals as the pipeline's own errors. */
function refusal(status: number, code: string): Error {
  if (status === 404 && code === 'unknown_parser') {
    return new ValidationError('The request is not valid.', [
      { path: 'parserId', message: 'unknown parser' },
    ]);
  }
  if (status === 415 || code === 'unsupported_file') return new UnsupportedMediaTypeError();
  if (status === 413) return new UnprocessableError('The file is too large to read.');
  if (code === 'invalid_spec') {
    return new ValidationError('The request is not valid.', [
      { path: 'spec', message: 'not a valid column mapping' },
    ]);
  }
  if (status === 422) return new UnprocessableError('The file could not be read with this format.');
  return new UpstreamError();
}

export function createParserClient(options: ParserClientOptions): ParserClient {
  const send = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.url.replace(/\/+$/, '');

  async function call<T>(
    path: string,
    data: Uint8Array,
    schema: z.ZodType<T>,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-parser-secret': options.secret,
          ...extraHeaders,
        },
        body: Buffer.from(data),
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
      });
    } catch (error) {
      logger.warn({ path, reason: (error as Error).name }, 'parser service unreachable');
      throw new UpstreamError();
    }
    if (!response.ok) {
      const body = errorSchema.safeParse(await response.json().catch(() => null));
      const code = body.success ? body.data.code : '';
      logger.warn({ path, status: response.status, code }, 'parser service refused');
      throw refusal(response.status, code);
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      logger.error({ path }, 'parser service answered with an unexpected shape');
      throw new UpstreamError();
    }
    return parsed.data;
  }

  return {
    async detect(data) {
      return (await call('/detect', data, detectSchema)).results;
    },
    parse(data, parserId) {
      return call(`/parse?parser_id=${encodeURIComponent(parserId)}`, data, parserResponseSchema);
    },
    propose(data) {
      return call('/propose', data, proposalSchema);
    },
    parseWithSpec(data, spec) {
      const encoded = Buffer.from(JSON.stringify(spec)).toString('base64url');
      return call('/parse-spec', data, parserResponseSchema, { 'x-import-spec': encoded });
    },
  };
}
