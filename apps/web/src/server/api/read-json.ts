import { ValidationError } from '@nestvault/services';

import { readBodyCapped } from './read-body';

export interface ReadJsonOptions {
  /** Hard limit on the body size in bytes; larger bodies get 413 before they are parsed. */
  maxBytes: number;
}

/**
 * Reads a JSON body without trusting `Content-Length`: the stream is counted and cut off at the
 * limit. Returns `unknown`; the caller validates it with a zod `.strict()` schema.
 */
export async function readJson(req: Request, { maxBytes }: ReadJsonOptions): Promise<unknown> {
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ValidationError('Content-Type must be application/json.');
  }
  const body = await readBodyCapped(req, maxBytes);
  try {
    // `fatal` makes malformed UTF-8 an error instead of silently becoming U+FFFD.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}
