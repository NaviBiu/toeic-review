import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import {
  normalizeReadingText,
  sanitizeReadingDocument,
  type SanitizedReadingContent,
} from './richContent';

export type SanitizedReadingContentServer = SanitizedReadingContent & {
  hash: string;
};

export function hashReadingText(text: string) {
  return createHash('sha256').update(normalizeReadingText(text)).digest('hex');
}

export function createSanitizedReadingDocumentServer(html: string): Document {
  const document = new JSDOM(html).window.document;
  sanitizeReadingDocument(document);
  return document;
}

export function sanitizeReadingHtmlServer(html: string): SanitizedReadingContentServer {
  const document = new JSDOM(html).window.document;
  const result = sanitizeReadingDocument(document);
  return { ...result, hash: hashReadingText(result.text) };
}
