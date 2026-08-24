import { describe, expect, it } from 'vitest';
import { buildTrainingSummary, normalizeTrainingCount } from '@/components/part5/TrainingSetup';

describe('training setup helpers', () => {
  it('normalizes the planned count within the eligible question count', () => {
    expect(normalizeTrainingCount(0, 8)).toBe(1);
    expect(normalizeTrainingCount(20, 8)).toBe(8);
    expect(normalizeTrainingCount(20, 0)).toBe(0);
  });

  it('summarizes the requested and available training questions', () => {
    expect(buildTrainingSummary(20, 8)).toBe('计划 20 题，可用 8 题，本次将练习 8 题');
  });
});
