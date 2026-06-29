import type { VercelClient } from '@vercel/postgres';

export type PartAccuracy = { part: number; correctCount: number; wrongCount: number; accuracy: number | null };
export type ScenarioAccuracy = { scenarioMajor: string; correctCount: number; wrongCount: number; accuracy: number | null };

export type KnowledgePointStats = {
  activeCount: number;
  masteredCount: number;
  byPart: PartAccuracy[];
  byScenarioMajor: ScenarioAccuracy[];
};

export function accuracyOf(correct: number, wrong: number): number | null {
  const total = correct + wrong;
  return total === 0 ? null : correct / total;
}

export async function getKnowledgePointStats(client: VercelClient): Promise<KnowledgePointStats> {
  const { rows: countRows } = await client.query(
    `SELECT status, count(*)::int as count FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY status`
  );
  const activeCount = countRows.find((r: any) => r.status === 'active')?.count ?? 0;
  const masteredCount = countRows.find((r: any) => r.status === 'mastered')?.count ?? 0;

  const { rows: partRows } = await client.query(
    `SELECT part, sum(correct_count)::int as correct, sum(wrong_count)::int as wrong
     FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY part ORDER BY part`
  );
  const byPart = partRows.map((r: any) => ({
    part: r.part, correctCount: r.correct, wrongCount: r.wrong, accuracy: accuracyOf(r.correct, r.wrong),
  }));

  const { rows: scenarioRows } = await client.query(
    `SELECT scenario_major, sum(correct_count)::int as correct, sum(wrong_count)::int as wrong
     FROM knowledge_points WHERE status IN ('active','mastered') GROUP BY scenario_major`
  );
  const byScenarioMajor = scenarioRows.map((r: any) => ({
    scenarioMajor: r.scenario_major, correctCount: r.correct, wrongCount: r.wrong, accuracy: accuracyOf(r.correct, r.wrong),
  }));

  return { activeCount, masteredCount, byPart, byScenarioMajor };
}
