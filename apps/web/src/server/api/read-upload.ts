import { PayloadTooLargeError, ValidationError, type UploadInput } from '@nestvault/services';

export interface ReadUploadOptions {
  /** Largest file accepted, in bytes. */
  maxFileBytes: number;
}

/** Room for the multipart envelope: boundaries, field names and the few small fields. */
const ENVELOPE_BYTES = 64 * 1024;
const MAX_FIELDS = 10;
const MAX_FIELD_CHARS = 16 * 1024;

/**
 * Reads a multipart upload (`file` plus a few text fields) without trusting `Content-Length`: the
 * body is counted while it is read and cut off at the limit, so an 11 MB upload is refused (413)
 * before it is held in memory. `spec` is a JSON text field; the rest are plain strings. Which
 * fields exist and what they may hold is the service's call (a strict schema); this only parses.
 */
export async function readUpload(
  req: Request,
  { maxFileBytes }: ReadUploadOptions,
): Promise<UploadInput> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
    throw new ValidationError('Content-Type must be multipart/form-data.');
  }
  const limit = maxFileBytes + ENVELOPE_BYTES;
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) throw new PayloadTooLargeError();

  const chunks: Uint8Array[] = [];
  let received = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }

  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new ValidationError('The upload is not valid multipart/form-data.');
  }

  let file: File | undefined;
  const fields: Record<string, unknown> = {};
  let count = 0;
  for (const [name, value] of form.entries()) {
    count += 1;
    if (count > MAX_FIELDS) throw new ValidationError('The upload has too many fields.');
    if (name === 'file') {
      if (file !== undefined || typeof value === 'string') {
        throw new ValidationError('Send exactly one file in the "file" field.');
      }
      file = value;
      continue;
    }
    if (typeof value !== 'string' || value.length > MAX_FIELD_CHARS || name in fields) {
      throw new ValidationError('The upload has a field that is not valid.');
    }
    fields[name] = name === 'spec' ? parseJsonField(value) : value;
  }
  if (file === undefined) throw new ValidationError('Send the statement in the "file" field.');
  if (file.size > maxFileBytes) throw new PayloadTooLargeError();
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), fields };
}

function parseJsonField(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('The "spec" field is not valid JSON.');
  }
}
