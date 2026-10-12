import { PayloadTooLargeError, ValidationError } from '@nestvault/services';

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
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new PayloadTooLargeError();

  const chunks: Uint8Array[] = [];
  let received = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }
  try {
    // `fatal` makes malformed UTF-8 an error instead of silently becoming U+FFFD.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}
