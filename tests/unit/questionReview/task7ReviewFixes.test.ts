import { describe, expect, it } from 'vitest';
import { canMergeCategories, deleteConfirmationPhrase } from '@/components/part5/CategoryManager';
import { attemptStatsSummary, canAbandonTraining } from '@/components/part5/TrainingSession';

describe('Task 7 review fixes', () => {
  it('allows second-level categories from different parents to merge', () => {
    expect(canMergeCategories({ parentId: 1 }, { parentId: 2 })).toBe(true);
    expect(canMergeCategories({ parentId: null }, { parentId: 2 })).toBe(false);
  });

  it('requires a named, irreversible-delete confirmation', () => {
    expect(deleteConfirmationPhrase('词性判断')).toBe('删除“词性判断”');
  });

  it('formats cumulative question attempt counts independently of session totals', () => {
    expect(attemptStatsSummary({ correctCount: 3, wrongCount: 2 })).toBe('累计：正确 3，错误 2');
  });

  it('blocks abandon while an answer submission is pending', () => {
    expect(canAbandonTraining(true)).toBe(false);
    expect(canAbandonTraining(false)).toBe(true);
  });
});
