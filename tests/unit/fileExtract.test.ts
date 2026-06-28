import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateUpload, extractText, UnsupportedFileTypeError, FileTooLargeError } from '../../src/lib/fileExtract';

describe('validateUpload', () => {
  it('accepts a .pdf filename within the size limit', () => {
    expect(validateUpload('notes.pdf', 1000)).toBe('pdf');
  });
  it('accepts a .docx filename within the size limit', () => {
    expect(validateUpload('notes.docx', 1000)).toBe('docx');
  });
  it('rejects an unsupported extension', () => {
    expect(() => validateUpload('notes.txt', 1000)).toThrow(UnsupportedFileTypeError);
  });
  it('rejects a file over the 5MB limit', () => {
    expect(() => validateUpload('notes.pdf', 6 * 1024 * 1024)).toThrow(FileTooLargeError);
  });
});

// Regression coverage for the production-only bug found 2026-06-28: pdf-parse's
// native canvas dependency never loaded correctly in Vercel's serverless function
// (worked locally, crashed with "DOMMatrix is not defined" in production), but
// every test and manual check up to that point only exercised validateUpload or
// used a .docx fixture -- nothing ever actually called extractText with a real
// PDF buffer, so the bug shipped undetected through the whole build. These tests
// run the real parsing library (unpdf / mammoth) against real file buffers.
describe('extractText', () => {
  it('extracts real text from a real PDF', async () => {
    const buf = fs.readFileSync(path.join(__dirname, '../fixtures/sample.pdf'));
    const text = await extractText('sample.pdf', buf);
    expect(text).toContain('negotiate');
  });

  it('extracts real text from a real DOCX', async () => {
    const buf = fs.readFileSync(path.join(__dirname, '../fixtures/sample.docx'));
    const text = await extractText('sample.docx', buf);
    expect(text).toContain('negotiate');
  });
});
