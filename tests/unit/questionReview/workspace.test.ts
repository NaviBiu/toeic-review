import { describe, expect, it } from 'vitest';
import type { CategoryNode } from '@/lib/questionReview/types';
import {
  buildTrainingSummary,
  getTrainingAvailability,
  normalizeTrainingCount,
} from '@/components/part5/TrainingSetup';

const allMasteredCategories: CategoryNode[] = [{
  id: 1,
  section: 'reading',
  part: 5,
  parentId: null,
  name: '词性判断',
  isDefault: false,
  status: 'active',
  sortOrder: 0,
  stats: {
    total: 3,
    learningCount: 0,
    masteredCount: 3,
    attempted: 2,
    unattempted: 1,
    latestCorrect: 2,
    accuracy: 1,
  },
  children: [{
    id: 2,
    section: 'reading',
    part: 5,
    parentId: 1,
    name: '未细分',
    isDefault: true,
    status: 'active',
    sortOrder: 0,
    stats: {
      total: 3,
      learningCount: 0,
      masteredCount: 3,
      attempted: 2,
      unattempted: 1,
      latestCorrect: 2,
      accuracy: 1,
    },
    children: [],
  }],
}];

describe('training setup helpers', () => {
  it('normalizes the planned count within the eligible question count', () => {
    expect(normalizeTrainingCount(0, 8)).toBe(1);
    expect(normalizeTrainingCount(20, 8)).toBe(8);
    expect(normalizeTrainingCount(20, 0)).toBe(0);
  });

  it('summarizes the requested and available training questions', () => {
    expect(buildTrainingSummary(20, 8)).toBe('计划 20 题，可用 8 题，本次将练习 8 题');
  });

  it('excludes an all-mastered scope until mastered questions are included', () => {
    expect(getTrainingAvailability(allMasteredCategories, 2, false, 20)).toEqual({
      available: 0,
      effectiveCount: 0,
      disabled: true,
    });
    expect(getTrainingAvailability(allMasteredCategories, null, true, 20)).toEqual({
      available: 3,
      effectiveCount: 3,
      disabled: false,
    });
  });
});
