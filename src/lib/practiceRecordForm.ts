export type PracticeSection = 'listening' | 'reading';
export type PracticeType = 'full_mock' | 'part_drill';
export type PracticePartNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PracticePartScore = {
  part: PracticePartNumber;
  correct: number;
  total: number;
};

export const PRACTICE_PART_TOTALS: Record<PracticePartNumber, number> = {
  1: 6,
  2: 25,
  3: 39,
  4: 30,
  5: 30,
  6: 16,
  7: 54,
};

const SECTION_PARTS: Record<PracticeSection, PracticePartNumber[]> = {
  listening: [1, 2, 3, 4],
  reading: [5, 6, 7],
};

export function partOptionsForSection(section: PracticeSection) {
  return [...SECTION_PARTS[section]];
}

export function defaultPracticeParts(
  section: PracticeSection,
  type: PracticeType,
): PracticePartScore[] {
  const parts = type === 'full_mock'
    ? SECTION_PARTS[section]
    : [section === 'listening' ? 2 : 5] satisfies PracticePartNumber[];

  return parts.map((part) => ({
    part,
    correct: 0,
    total: PRACTICE_PART_TOTALS[part],
  }));
}

export function filterRecordsBySection<T extends { section?: PracticeSection }>(
  records: T[],
  section: PracticeSection,
) {
  return records.filter((record) => (record.section ?? 'listening') === section);
}
