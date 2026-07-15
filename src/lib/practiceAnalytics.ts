export type PartNumber = 1 | 2 | 3 | 4;
export type Trend = 'improving' | 'declining' | 'flat' | 'not_enough_data';
export type TargetStatus = 'at_target' | 'below_target';

export type PartAttempt = {
  id: number | string;
  date: string;
  part: PartNumber;
  correct: number;
  total: number;
};

export type PartTarget = {
  part: PartNumber;
  targetRatio: number;
  targetCorrect: number;
  maxWrong: number;
  targetScore: number;
  role: string;
};

export type PartDiagnosticPoint = {
  id: string;
  date: string;
  correct: number;
  total: number;
  ratio: number | null;
  gapToTarget: number | null;
};

export type PartDiagnostic = {
  part: PartNumber;
  targetRatio: number;
  targetCorrect: number;
  maxWrong: number;
  targetScore: number;
  role: string;
  attempts: PartDiagnosticPoint[];
  longTermRatio: number | null;
  latestRatio: number | null;
  latestGap: number | null;
  trend: Trend;
  status: TargetStatus;
};

export const LISTENING_800_TARGETS: Record<PartNumber, PartTarget> = {
  1: { part: 1, targetRatio: 1, targetCorrect: 6, maxWrong: 0, targetScore: 25, role: '基础分，建议满分' },
  2: { part: 2, targetRatio: 0.88, targetCorrect: 22, maxWrong: 3, targetScore: 105, role: '提分性价比最高' },
  3: { part: 3, targetRatio: 0.82, targetCorrect: 32, maxWrong: 7, targetScore: 155, role: '主力得分区' },
  4: { part: 4, targetRatio: 0.77, targetCorrect: 23, maxWrong: 7, targetScore: 115, role: '可容错，但不能崩' },
};

export function ratioOf(correct: number, total: number) {
  return total > 0 ? correct / total : null;
}

function dateValue(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function averageRatio(attempts: PartAttempt[]) {
  const correct = attempts.reduce((sum, attempt) => sum + attempt.correct, 0);
  const total = attempts.reduce((sum, attempt) => sum + attempt.total, 0);
  return ratioOf(correct, total);
}

function trendOf(attempts: PartAttempt[]): Trend {
  if (attempts.length < 3) return 'not_enough_data';

  const midpoint = Math.floor(attempts.length / 2);
  const early = averageRatio(attempts.slice(0, midpoint));
  const recent = averageRatio(attempts.slice(midpoint));
  if (early === null || recent === null) return 'not_enough_data';

  const diff = recent - early;
  if (diff >= 0.03) return 'improving';
  if (diff <= -0.03) return 'declining';
  return 'flat';
}

export function buildPartDiagnostics(attempts: PartAttempt[]) {
  return ([1, 2, 3, 4] as PartNumber[])
    .map((part): PartDiagnostic | null => {
      const target = LISTENING_800_TARGETS[part];
      const partAttempts = attempts
        .filter((attempt) => attempt.part === part)
        .sort((a, b) => dateValue(a.date) - dateValue(b.date));

      if (partAttempts.length === 0) return null;

      const longTermRatio = averageRatio(partAttempts);
      const latestAttempt = partAttempts[partAttempts.length - 1];
      const latestRatio = ratioOf(latestAttempt.correct, latestAttempt.total);

      return {
        part,
        targetRatio: target.targetRatio,
        targetCorrect: target.targetCorrect,
        maxWrong: target.maxWrong,
        targetScore: target.targetScore,
        role: target.role,
        attempts: partAttempts.map((attempt) => {
          const ratio = ratioOf(attempt.correct, attempt.total);
          return {
            id: `${attempt.id}-${attempt.part}`,
            date: attempt.date,
            correct: attempt.correct,
            total: attempt.total,
            ratio,
            gapToTarget: ratio === null ? null : ratio - target.targetRatio,
          };
        }),
        longTermRatio,
        latestRatio,
        latestGap: latestRatio === null ? null : latestRatio - target.targetRatio,
        trend: trendOf(partAttempts),
        status: longTermRatio !== null && longTermRatio >= target.targetRatio ? 'at_target' : 'below_target',
      };
    })
    .filter((diagnostic): diagnostic is PartDiagnostic => diagnostic !== null);
}
