import { describe, expect, test } from 'vitest';
import {
  getDisguiseTitle,
  getNextWorkSkin,
  workModeNav,
  workReviewCopy,
  workSkins,
} from '../../src/lib/disguiseMode';

describe('disguise mode labels', () => {
  test('uses English requirements-document navigation labels', () => {
    expect(workModeNav.map((item) => item.label)).toEqual([
      'Review Notes',
      'Issue Library',
      'Import Brief',
      'Resolved Items',
      'Progress Metrics',
      'Reporting',
    ]);
  });

  test('maps the practice page to a requirements-style section title', () => {
    expect(getDisguiseTitle('/review')).toBe('Daily Review Requirements');
    expect(getDisguiseTitle('/mock-exams')).toBe('Progress Metrics Requirements');
    expect(getDisguiseTitle('/unknown')).toBe('Requirements Review Brief');
  });

  test('provides five local document skins and never repeats the active skin', () => {
    expect(workSkins).toHaveLength(5);
    expect(getNextWorkSkin('requirements', () => 0).id).not.toBe('requirements');
  });

  test('provides English copy for the interactive review controls', () => {
    expect(workReviewCopy.pending(14)).toBe('14 items pending');
    expect(workReviewCopy.confirmed).toBe('Confirmed');
    expect(workReviewCopy.followUp).toBe('Needs follow-up');
    expect(workReviewCopy.mastered).toBe('Mark as mastered');
  });
});
