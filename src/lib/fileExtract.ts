import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}

const MAX_BYTES = 5 * 1024 * 1024;

export function validateUpload(filename: string, byteLength: number): 'pdf' | 'docx' {
  if (byteLength > MAX_BYTES) {
    throw new FileTooLargeError('文件超过 5MB 上限');
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  throw new UnsupportedFileTypeError('不支持此文件格式,请上传文字版 PDF 或 Word');
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const kind = validateUpload(filename, buffer.byteLength);
  if (kind === 'pdf') {
    // pdf-parse v2 dropped the v1 default-export function API in favor of a
    // class with getText()/destroy(); the brief's snippet targeted v1.
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
