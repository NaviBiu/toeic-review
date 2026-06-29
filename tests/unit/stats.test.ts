import { describe, it, expect } from 'vitest';
import { accuracyOf } from '../../src/lib/stats';

describe('accuracyOf', () => {
  it('returns null when there is no review history yet (no division by zero)', () => {
    expect(accuracyOf(0, 0)).toBeNull();
  });

  it('computes correct / (correct + wrong)', () => {
    expect(accuracyOf(1, 1)).toBeCloseTo(0.5);
    expect(accuracyOf(3, 1)).toBeCloseTo(0.75);
  });

  it('returns 1 when every attempt was correct', () => {
    expect(accuracyOf(5, 0)).toBe(1);
  });

  it('returns 0 when every attempt was wrong', () => {
    expect(accuracyOf(0, 5)).toBe(0);
  });
});
