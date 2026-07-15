import { describe, expect, test } from 'vitest';
import {
  LISTENING_800_TARGETS,
  buildPartDiagnostics,
  ratioOf,
} from '../../src/lib/practiceAnalytics';

describe('practice analytics', () => {
  test('uses the listening 800 target baseline per part', () => {
    expect(LISTENING_800_TARGETS[1].targetRatio).toBe(1);
    expect(LISTENING_800_TARGETS[2].targetRatio).toBeCloseTo(0.88, 3);
    expect(LISTENING_800_TARGETS[3].targetRatio).toBeCloseTo(0.82, 3);
    expect(LISTENING_800_TARGETS[4].targetRatio).toBeCloseTo(0.77, 3);
  });

  test('builds long-term diagnostics against the part baseline', () => {
    const diagnostics = buildPartDiagnostics([
      { id: 1, date: '2026-07-01', part: 2, correct: 21, total: 25 },
      { id: 2, date: '2026-07-08', part: 2, correct: 22, total: 25 },
      { id: 3, date: '2026-07-15', part: 2, correct: 23, total: 25 },
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      part: 2,
      latestRatio: ratioOf(23, 25),
      targetRatio: LISTENING_800_TARGETS[2].targetRatio,
      status: 'at_target',
    });
    expect(diagnostics[0].trend).toBe('improving');
  });
});
