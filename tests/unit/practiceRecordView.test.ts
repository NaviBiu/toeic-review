import { describe, expect, it } from 'vitest';
import { formatPracticeSource } from '../../src/lib/practiceRecordView';

describe('formatPracticeSource', () => {
  it('collapses a long web address into a stable link label', () => {
    expect(formatPracticeSource('https://www.youtube.com/watch?v=abc&list=long')).toEqual({
      label: '打开练习链接',
      href: 'https://www.youtube.com/watch?v=abc&list=long',
    });
  });

  it('keeps a normal practice title as plain text', () => {
    expect(formatPracticeSource('Part 3 专项训练')).toEqual({ label: 'Part 3 专项训练', href: null });
  });
});
