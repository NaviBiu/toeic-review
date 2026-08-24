import { describe, expect, it } from 'vitest';
import { shouldApplyQuestionListResponse } from '@/components/part5/QuestionLibrary';
import { beginCategoryRefresh } from '@/components/part5/Part5Workspace';
import type { CategoryNode } from '@/lib/questionReview/types';

const categories: CategoryNode[] = [{
  id: 1,
  section: 'reading',
  part: 5,
  parentId: null,
  name: '词性判断',
  isDefault: false,
  status: 'active',
  sortOrder: 0,
  stats: {
    total: 2,
    learningCount: 2,
    masteredCount: 0,
    attempted: 0,
    unattempted: 2,
    latestCorrect: 0,
    accuracy: null,
  },
  children: [],
}];

describe('Task 6 UI state helpers', () => {
  it('accepts only the latest non-aborted list response', () => {
    const current = new AbortController();
    const stale = new AbortController();
    stale.abort();

    expect(shouldApplyQuestionListResponse(current.signal, 3, 3)).toBe(true);
    expect(shouldApplyQuestionListResponse(current.signal, 2, 3)).toBe(false);
    expect(shouldApplyQuestionListResponse(stale.signal, 3, 3)).toBe(false);
  });

  it('keeps loaded categories mounted during a background refresh', () => {
    expect(beginCategoryRefresh(categories)).toEqual({
      categories,
      initialLoading: false,
      error: '',
    });
    expect(beginCategoryRefresh(null)).toEqual({
      categories: null,
      initialLoading: true,
      error: '',
    });
  });
});
