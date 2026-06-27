import { describe, it, expect } from 'vitest';
import { todayInShanghai, addDays, isFutureDate } from '../../src/lib/dateUtils';

describe('todayInShanghai', () => {
  it('formats a given UTC instant as YYYY-MM-DD in Asia/Shanghai', () => {
    // 2026-06-26T20:00:00Z is 2026-06-27 04:00 in Shanghai (UTC+8)
    expect(todayInShanghai(new Date('2026-06-26T20:00:00Z'))).toBe('2026-06-27');
  });
});

describe('addDays', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-06-28', 4)).toBe('2026-07-02');
  });
  it('adds zero days unchanged', () => {
    expect(addDays('2026-06-26', 0)).toBe('2026-06-26');
  });
});

describe('isFutureDate', () => {
  it('returns true when the date is after today', () => {
    expect(isFutureDate('2026-07-01', '2026-06-26')).toBe(true);
  });
  it('returns false when the date equals today', () => {
    expect(isFutureDate('2026-06-26', '2026-06-26')).toBe(false);
  });
  it('returns false when the date is before today', () => {
    expect(isFutureDate('2026-06-01', '2026-06-26')).toBe(false);
  });
});
