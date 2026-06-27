import type { VercelClient } from '@vercel/postgres';

type PartScore = { correct: number; total: number };
type ScenarioScore = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };

export type MockExamInput = {
  testDate: string;
  part1: PartScore;
  part2: PartScore;
  part3: PartScore;
  part4: PartScore;
  scenarios: ScenarioScore[];
};

export type MockExamResult = {
  id: number;
  testDate: string;
  part1: PartScore;
  part2: PartScore;
  part3: PartScore;
  part4: PartScore;
  scenarios: ScenarioScore[];
};

function validatePart(label: string, score: PartScore) {
  if (score.total < 1) throw new Error(`${label}: 总题数必须至少为 1`);
  if (score.correct < 0 || score.correct > score.total) throw new Error(`${label}: 对题数必须在 0 到总题数之间`);
}

export async function createMockExam(client: VercelClient, input: MockExamInput): Promise<MockExamResult> {
  validatePart('part1', input.part1);
  validatePart('part2', input.part2);
  validatePart('part3', input.part3);
  validatePart('part4', input.part4);
  input.scenarios.forEach((s, i) => validatePart(`scenario[${i}]`, s));

  const { rows } = await client.query(
    `INSERT INTO mock_exam_results
       (test_date, part1_correct, part1_total, part2_correct, part2_total,
        part3_correct, part3_total, part4_correct, part4_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.testDate,
      input.part1.correct, input.part1.total,
      input.part2.correct, input.part2.total,
      input.part3.correct, input.part3.total,
      input.part4.correct, input.part4.total,
    ]
  );
  const id = rows[0].id;

  for (const s of input.scenarios) {
    await client.query(
      `INSERT INTO mock_exam_scenario_scores (mock_exam_result_id, scenario_major, scenario_minor, correct, total)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, s.scenarioMajor, s.scenarioMinor, s.correct, s.total]
    );
  }

  return { id, testDate: input.testDate, part1: input.part1, part2: input.part2, part3: input.part3, part4: input.part4, scenarios: input.scenarios };
}

export async function listMockExams(client: VercelClient): Promise<MockExamResult[]> {
  const { rows } = await client.query('SELECT * FROM mock_exam_results ORDER BY test_date DESC');
  const results: MockExamResult[] = [];
  for (const row of rows) {
    const { rows: scenarioRows } = await client.query(
      'SELECT scenario_major, scenario_minor, correct, total FROM mock_exam_scenario_scores WHERE mock_exam_result_id = $1',
      [row.id]
    );
    results.push({
      id: row.id,
      testDate: row.test_date,
      part1: { correct: row.part1_correct, total: row.part1_total },
      part2: { correct: row.part2_correct, total: row.part2_total },
      part3: { correct: row.part3_correct, total: row.part3_total },
      part4: { correct: row.part4_correct, total: row.part4_total },
      scenarios: scenarioRows.map((s: any) => ({
        scenarioMajor: s.scenario_major,
        scenarioMinor: s.scenario_minor,
        correct: s.correct,
        total: s.total,
      })),
    });
  }
  return results;
}
