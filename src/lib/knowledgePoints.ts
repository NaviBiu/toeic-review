import type { VercelClient } from '@vercel/postgres';
import './db'; // registers the DATE type-parser fix (see db.ts) before any query runs
import { normalizeTerm } from './termNormalize';
import { applyCorrectAnswer, applyWrongAnswer, type SrsState } from './srs';
import { isValidScenario } from './scenarios';

export type KnowledgePoint = {
  id: number;
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  scenarioMajor: string;
  scenarioMinor: string;
  skill: string;
  dateAdded: string;
  status: 'active' | 'mastered' | 'deleted';
  correctStreak: number;
  correctCount: number;
  wrongCount: number;
  nextReviewDate: string | null;
  lastReviewedDate: string | null;
};

function mapRow(row: any): KnowledgePoint {
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    example: row.example,
    notes: row.notes,
    part: row.part,
    scenarioMajor: row.scenario_major,
    scenarioMinor: row.scenario_minor,
    skill: row.skill,
    dateAdded: row.date_added,
    status: row.status,
    correctStreak: row.correct_streak,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    nextReviewDate: row.next_review_date,
    lastReviewedDate: row.last_reviewed_date,
  };
}

export async function findMatch(
  client: VercelClient,
  term: string,
  part: number,
  scenarioMajor: string,
  scenarioMinor: string,
  skill: string
): Promise<KnowledgePoint | null> {
  const target = normalizeTerm(term);
  const { rows } = await client.query(
    `SELECT * FROM knowledge_points
     WHERE part = $1 AND scenario_major = $2 AND scenario_minor = $3 AND skill = $4 AND status != 'deleted'`,
    [part, scenarioMajor, scenarioMinor, skill]
  );
  const match = rows.find((row: any) => normalizeTerm(row.term) === target);
  return match ? mapRow(match) : null;
}

export async function insertKnowledgePoint(
  client: VercelClient,
  data: {
    term: string;
    meaning: string;
    example: string;
    notes: string | null;
    part: number;
    scenarioMajor: string;
    scenarioMinor: string;
    skill: string;
    dateAdded: string;
  }
): Promise<KnowledgePoint> {
  if (!isValidScenario(data.scenarioMajor, data.scenarioMinor)) {
    throw new Error('场景分类不在允许的列表内');
  }
  const { rows } = await client.query(
    `INSERT INTO knowledge_points
       (term, meaning, example, notes, part, scenario_major, scenario_minor, skill, date_added, status, correct_streak, next_review_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 0, $9)
     RETURNING *`,
    [data.term, data.meaning, data.example, data.notes, data.part, data.scenarioMajor, data.scenarioMinor, data.skill, data.dateAdded]
  );
  return mapRow(rows[0]);
}

export async function applyReviewResult(
  client: VercelClient,
  id: number,
  wasCorrect: boolean,
  today: string
): Promise<KnowledgePoint> {
  const { rows } = await client.query('SELECT * FROM knowledge_points WHERE id = $1', [id]);
  const current = mapRow(rows[0]);
  const state: SrsState = {
    correctStreak: current.correctStreak,
    wrongCount: current.wrongCount,
    correctCount: current.correctCount,
    status: current.status === 'mastered' ? 'mastered' : 'active',
    nextReviewDate: current.nextReviewDate,
  };
  const next = wasCorrect ? applyCorrectAnswer(state, today) : applyWrongAnswer(state, today);
  const { rows: updated } = await client.query(
    `UPDATE knowledge_points
     SET correct_streak = $1, correct_count = $2, wrong_count = $3, status = $4,
         next_review_date = $5, last_reviewed_date = $6, updated_at = now()
     WHERE id = $7
     RETURNING *`,
    [next.correctStreak, next.correctCount, next.wrongCount, next.status, next.nextReviewDate, today, id]
  );
  return mapRow(updated[0]);
}

export async function reviveFromImport(
  client: VercelClient,
  id: number,
  today: string
): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points
     SET status = 'active', correct_streak = 0, wrong_count = wrong_count + 1,
         next_review_date = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [today, id]
  );
  return mapRow(rows[0]);
}

export async function softDeleteKnowledgePoint(client: VercelClient, id: number): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points SET status = 'deleted', next_review_date = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return mapRow(rows[0]);
}

export async function restoreKnowledgePoint(client: VercelClient, id: number, today: string): Promise<KnowledgePoint> {
  const { rows } = await client.query(
    `UPDATE knowledge_points
     SET status = 'active', correct_streak = 0, next_review_date = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [today, id]
  );
  return mapRow(rows[0]);
}

export async function updateKnowledgePointFields(
  client: VercelClient,
  id: number,
  fields: Partial<{
    term: string;
    meaning: string;
    example: string;
    notes: string | null;
    part: number;
    scenarioMajor: string;
    scenarioMinor: string;
    dateAdded: string;
  }>
): Promise<KnowledgePoint> {
  const identityChanged = ['term', 'part', 'scenarioMajor', 'scenarioMinor'].some((k) => k in fields);
  if (identityChanged) {
    const { rows: currentRows } = await client.query('SELECT * FROM knowledge_points WHERE id = $1', [id]);
    const current = mapRow(currentRows[0]);
    const candidateTerm = fields.term ?? current.term;
    const candidatePart = fields.part ?? current.part;
    const candidateMajor = fields.scenarioMajor ?? current.scenarioMajor;
    const candidateMinor = fields.scenarioMinor ?? current.scenarioMinor;
    if (!isValidScenario(candidateMajor, candidateMinor)) {
      throw new Error('场景分类不在允许的列表内');
    }
    const { rows: candidateRows } = await client.query(
      `SELECT term FROM knowledge_points
       WHERE id != $1 AND part = $2 AND scenario_major = $3 AND scenario_minor = $4 AND skill = $5 AND status != 'deleted'`,
      [id, candidatePart, candidateMajor, candidateMinor, current.skill]
    );
    const conflict = candidateRows.some((row: any) => normalizeTerm(row.term) === normalizeTerm(candidateTerm));
    if (conflict) {
      throw new Error('这个组合已经存在,请检查是否要合并');
    }
  }

  const setClauses: string[] = [];
  const values: any[] = [];
  let i = 1;
  const columnMap: Record<string, string> = {
    term: 'term',
    meaning: 'meaning',
    example: 'example',
    notes: 'notes',
    part: 'part',
    scenarioMajor: 'scenario_major',
    scenarioMinor: 'scenario_minor',
    dateAdded: 'date_added',
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in columnMap)) continue;
    setClauses.push(`${columnMap[key]} = $${i}`);
    values.push(value);
    i++;
  }
  setClauses.push(`updated_at = now()`);
  values.push(id);
  const { rows } = await client.query(
    `UPDATE knowledge_points SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return mapRow(rows[0]);
}

export async function listKnowledgePoints(
  client: VercelClient,
  filters: { part?: number; scenarioMajor?: string; scenarioMinor?: string; status?: string } = {}
): Promise<KnowledgePoint[]> {
  const clauses: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (filters.part !== undefined) {
    clauses.push(`part = $${i++}`);
    values.push(filters.part);
  }
  if (filters.scenarioMajor !== undefined) {
    clauses.push(`scenario_major = $${i++}`);
    values.push(filters.scenarioMajor);
  }
  if (filters.scenarioMinor !== undefined) {
    clauses.push(`scenario_minor = $${i++}`);
    values.push(filters.scenarioMinor);
  }
  clauses.push(`status = $${i++}`);
  values.push(filters.status ?? 'active');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await client.query(`SELECT * FROM knowledge_points ${where} ORDER BY date_added DESC`, values);
  return rows.map(mapRow);
}

export async function getTodayQueue(
  client: VercelClient,
  today: string,
  filters: { scenarioMajor?: string; scenarioMinor?: string } = {}
): Promise<KnowledgePoint[]> {
  const clauses = [`status = 'active'`, `next_review_date <= $1`];
  const values: any[] = [today];
  let i = 2;
  if (filters.scenarioMajor !== undefined) {
    clauses.push(`scenario_major = $${i++}`);
    values.push(filters.scenarioMajor);
  }
  if (filters.scenarioMinor !== undefined) {
    clauses.push(`scenario_minor = $${i++}`);
    values.push(filters.scenarioMinor);
  }
  const { rows } = await client.query(
    `SELECT * FROM knowledge_points WHERE ${clauses.join(' AND ')} ORDER BY wrong_count DESC, next_review_date ASC`,
    values
  );
  return rows.map(mapRow);
}
