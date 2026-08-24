import { describe, expect, it } from 'vitest';
import { elapsedMs, normalizeEditedDuration } from '@/lib/questionReview/timing';

describe('question review timing', () => {
  it('calculates elapsed milliseconds and prevents negative clock movement', () => {
    expect(elapsedMs(1000, 4500)).toBe(3500);
    expect(elapsedMs(4500, 1000)).toBe(0);
  });

  it('normalizes an edited duration in seconds', () => {
    expect(normalizeEditedDuration('12.5')).toBe(12500);
    expect(normalizeEditedDuration('   ')).toBeNull();
  });

  it('rejects a negative edited duration', () => {
    expect(() => normalizeEditedDuration('-1')).toThrow('用时不能小于 0');
  });
});
