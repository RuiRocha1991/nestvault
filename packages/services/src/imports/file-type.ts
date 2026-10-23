import { UnsupportedMediaTypeError } from '../errors';

// What an upload really is, decided from its bytes. The file name and the browser's content type
// are claims of the client: a renamed `.exe` must not get past a `.xlsx` extension (security
// control 14). Only the three formats the parser service reads are accepted, and the extension
// must agree with the content.

export type UploadKind = 'xlsx' | 'pdf' | 'csv';

const EXTENSIONS: Readonly<Record<string, UploadKind>> = {
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pdf: 'pdf',
  csv: 'csv',
  tsv: 'csv',
  txt: 'csv',
};

const SNIFF_BYTES = 8192;
const MAX_CONTROL_RATIO = 0.01;

const startsWith = (bytes: Uint8Array, text: string): boolean =>
  text.split('').every((char, at) => bytes[at] === char.charCodeAt(0));

function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SNIFF_BYTES);
  if (head.length === 0) return false;
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) control += 1;
  }
  return control / head.length <= MAX_CONTROL_RATIO;
}

/** An Office Open XML workbook: a zip with `[Content_Types].xml` and `xl/workbook...`. */
function looksLikeWorkbook(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, 'PK\u0003\u0004')) return false;
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return text.includes('[Content_Types].xml') && text.includes('xl/workbook');
}

export function contentKindOf(bytes: Uint8Array): UploadKind | undefined {
  if (startsWith(bytes, '%PDF-')) return 'pdf';
  if (looksLikeWorkbook(bytes)) return 'xlsx';
  if (looksLikeText(bytes)) return 'csv';
  return undefined;
}

/** The kind of an upload, or `UnsupportedMediaTypeError` when the content or the name disagree. */
export function sniffUpload(bytes: Uint8Array, fileName: string): UploadKind {
  const extension = /^[^.].*\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1]?.toLowerCase();
  const declared = extension === undefined ? undefined : EXTENSIONS[extension];
  const actual = contentKindOf(bytes);
  if (declared === undefined || actual === undefined || declared !== actual) {
    throw new UnsupportedMediaTypeError('Upload an .xlsx, .pdf or .csv statement.');
  }
  return actual;
}

/** The name as stored and shown: no path, no control characters, at most 200 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned.length > 0 ? cleaned : 'statement').slice(0, 200);
}
