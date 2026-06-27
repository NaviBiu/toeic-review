import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  const [kp, mockResults, mockScores] = await Promise.all([
    sql`SELECT * FROM knowledge_points`,
    sql`SELECT * FROM mock_exam_results`,
    sql`SELECT * FROM mock_exam_scenario_scores`,
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    knowledgePoints: kp.rows,
    mockExamResults: mockResults.rows,
    mockExamScenarioScores: mockScores.rows,
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="toeic-review-export.json"',
    },
  });
}
