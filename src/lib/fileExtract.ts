import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
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
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.doc')) {
    // mammoth only reads the modern .docx (zip/OOXML) format -- a real legacy
    // .doc (binary OLE2) buffer makes it throw "Can't find end of central
    // directory", which isn't a clean, user-facing error. Reject it here
    // with an actionable message instead of letting it crash later.
    throw new UnsupportedFileTypeError('不支持旧版 .doc 格式,请在 Word 里用"另存为"转换成 .docx 后重新上传');
  }
  throw new UnsupportedFileTypeError('不支持此文件格式,请上传文字版 PDF 或 Word(.docx)');
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const kind = validateUpload(filename, buffer.byteLength);
  if (kind === 'pdf') {
    // pdf-parse pulls in pdfjs-dist's full build, which loads @napi-rs/canvas's
    // native binary at runtime -- Vercel's serverless function deploy doesn't
    // reliably include that binary (confirmed by a real production crash:
    // "ReferenceError: DOMMatrix is not defined"), and outputFileTracingIncludes
    // didn't fix it either. unpdf ships a canvas-free serverless PDF.js build
    // made for exactly this environment, so it has no native dependency to lose.
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
