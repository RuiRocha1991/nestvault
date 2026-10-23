import { describe, expect, it } from 'vitest';

import {
  cleanFileName,
  contentKindOf,
  sniffUpload,
  UnsupportedMediaTypeError,
} from '@nestvault/services';

const text = (value: string) => Buffer.from(value, 'utf8');

/** What the sniff looks at: the zip signature and the names of the workbook's entries. */
const zipWith = (...entries: string[]) =>
  Buffer.concat([
    Buffer.from('PK\u0003\u0004'),
    ...entries.map((name) => Buffer.from(`\0\0${name}\0`)),
  ]);
const workbook = () => zipWith('[Content_Types].xml', 'xl/workbook.xml');

describe('sniffUpload', () => {
  it('accepts a workbook, a pdf and a csv whose names agree with their content', () => {
    expect(sniffUpload(workbook(), 'extrato.xlsx')).toBe('xlsx');
    expect(sniffUpload(workbook(), 'posicao.XLSM')).toBe('xlsx');
    expect(sniffUpload(text('%PDF-1.7\n...'), 'extrato.pdf')).toBe('pdf');
    expect(sniffUpload(text('Data;Descrição;Valor\n01-01-2026;Café;-1,20\n'), 'movs.csv')).toBe(
      'csv',
    );
    expect(sniffUpload(text('a\tb\n1\t2\n'), 'movs.tsv')).toBe('csv');
    expect(sniffUpload(Buffer.from('Data;Descrição\n01-01-2026;Café\n', 'latin1'), 'a.txt')).toBe(
      'csv',
    );
  });

  it('rejects an executable renamed .xlsx', () => {
    const exe = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.alloc(200, 0),
      Buffer.from('This program'),
    ]);
    expect(() => sniffUpload(exe, 'extrato.xlsx')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(exe, 'extrato.exe')).toThrow(UnsupportedMediaTypeError);
  });

  it('rejects an ELF binary, a png and a plain zip', () => {
    expect(() => sniffUpload(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 1]), 'a.csv')).toThrow(
      UnsupportedMediaTypeError,
    );
    expect(() => sniffUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'a.csv')).toThrow(
      UnsupportedMediaTypeError,
    );
    const zip = zipWith('a.txt');
    expect(() => sniffUpload(zip, 'a.xlsx')).toThrow(UnsupportedMediaTypeError);
  });

  it('rejects a name that disagrees with the content', () => {
    expect(() => sniffUpload(text('%PDF-1.7'), 'extrato.xlsx')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(workbook(), 'extrato.pdf')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(text('a;b\n'), 'extrato.pdf')).toThrow(UnsupportedMediaTypeError);
  });

  it('rejects unknown or missing extensions and empty files', () => {
    expect(() => sniffUpload(text('a;b\n'), 'extrato.exe')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(text('a;b\n'), 'extrato')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(text('a;b\n'), '.csv')).toThrow(UnsupportedMediaTypeError);
    expect(() => sniffUpload(Buffer.alloc(0), 'a.csv')).toThrow(UnsupportedMediaTypeError);
  });

  it('rejects text with control characters', () => {
    const noisy = Buffer.alloc(500, 0x01);
    expect(contentKindOf(noisy)).toBeUndefined();
  });
});

describe('cleanFileName', () => {
  it.each([
    ['extrato.csv', 'extrato.csv'],
    ['C:\\Users\\rui\\extrato.csv', 'extrato.csv'],
    ['../../etc/passwd', 'passwd'],
    ['a\u0000b\nc.csv', 'abc.csv'],
    ['   ', 'statement'],
    ['', 'statement'],
    ['dir/', 'statement'],
    ['x'.repeat(300), 'x'.repeat(200)],
  ])('%j -> %j', (input, expected) => {
    expect(cleanFileName(input)).toBe(expected);
  });
});
