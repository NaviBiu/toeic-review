import { describe, expect, it } from 'vitest';

import {
  defaultPracticeParts,
  filterRecordsBySection,
  partOptionsForSection,
} from '../../src/lib/practiceRecordForm';

describe('practice record form configuration', () => {
  it('uses Parts 5-7 and official totals for complete reading practice', () => {
    expect(partOptionsForSection('reading')).toEqual([5, 6, 7]);
    expect(defaultPracticeParts('reading', 'full_mock')).toEqual([
      { part: 5, correct: 0, total: 30 },
      { part: 6, correct: 0, total: 16 },
      { part: 7, correct: 0, total: 54 },
    ]);
  });

  it('starts a reading drill with Part 5 only', () => {
    expect(defaultPracticeParts('reading', 'part_drill')).toEqual([
      { part: 5, correct: 0, total: 30 },
    ]);
  });

  it('keeps the existing listening defaults', () => {
    expect(partOptionsForSection('listening')).toEqual([1, 2, 3, 4]);
    expect(defaultPracticeParts('listening', 'part_drill')).toEqual([
      { part: 2, correct: 0, total: 25 },
    ]);
  });

  it('treats legacy records without a section as listening', () => {
    const records = [
      { id: 1 },
      { id: 2, section: 'listening' as const },
      { id: 3, section: 'reading' as const },
    ];

    expect(filterRecordsBySection(records, 'listening').map((record) => record.id)).toEqual([1, 2]);
    expect(filterRecordsBySection(records, 'reading').map((record) => record.id)).toEqual([3]);
  });
});
