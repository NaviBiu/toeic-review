import { describe, it, expect } from 'vitest';
import { normalizeTerm } from '../../src/lib/termNormalize';

describe('normalizeTerm', () => {
  it('treats check-in, check in, and checkin as the same term', () => {
    const normalized = new Set(['check-in', 'check in', 'checkin'].map(normalizeTerm));
    expect(normalized.size).toBe(1);
  });
  it('is case-insensitive', () => {
    expect(normalizeTerm('Workshop')).toBe(normalizeTerm('workshop'));
  });
  it("strips apostrophes", () => {
    expect(normalizeTerm("don't")).toBe('dont');
  });
  it('ignores trailing punctuation copied from note formatting', () => {
    expect(normalizeTerm('place an order，')).toBe(normalizeTerm('place an order'));
    expect(normalizeTerm('as a result,')).toBe(normalizeTerm('as a result'));
  });
});
