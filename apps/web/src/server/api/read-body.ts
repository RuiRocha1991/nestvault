import { PayloadTooLargeError } from '@nestvault/services';

/**
 * Reads a request body without trusting `Content-Length`: the stream is counted and cut off at
 * `maxBytes` (413), so an oversized body is never held in memory.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
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
  return Buffer.concat(chunks);
}
