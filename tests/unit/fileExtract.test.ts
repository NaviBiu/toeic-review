import { describe, it, expect } from 'vitest';
import { validateUpload, UnsupportedFileTypeError, FileTooLargeError } from '../../src/lib/fileExtract';

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
