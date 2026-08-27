import type { VercelClient } from '@vercel/postgres';

export type PracticeType = 'full_mock' | 'part_drill';
export type PracticeSection = 'listening' | 'reading';
export type PartNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PartScore = { part: PartNumber; correct: number; total: number };
export type LegacyPartScore = { correct: number; total: number };
export type ScenarioScore = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };
export type PracticeAttachment = { id: number; name: string; mimeType: string; dataUrl: string };
export type PracticeAttachmentInput = { name: string; mimeType: string; dataUrl: string };

type PracticeSessionRow = {
  id: number;
  practice_date: string;
  section?: PracticeSection;
  type: PracticeType;
  title: string | null;
  notes: string | null;
};
type PartScoreRow = { practice_session_id: number; part: PartNumber; correct: number; total: number };
type ScenarioScoreRow = {
  practice_session_id: number;
  scenario_major: string;
  scenario_minor: string;
  correct: number;
  total: number;
};
type PracticeAttachmentRow = {
  id: number;
  practice_session_id: number;
  name: string;
  mime_type: string;
  data_url?: string;
};

function practiceAttachmentUrl(id: number): string {
  return `/api/mock-exams/attachments/${id}`;
}

type LegacyMockExamInput = {
  testDate: string;
  part1: LegacyPartScore;
  part2: LegacyPartScore;
  part3: LegacyPartScore;
  part4: LegacyPartScore;
  scenarios: ScenarioScore[];
};

export type PracticeSessionInput = {
  practiceDate?: string;
  testDate?: string;
  section?: PracticeSection;
  type?: PracticeType;
  title?: string | null;
  notes?: string | null;
  parts?: PartScore[];
  scenarios?: ScenarioScore[];
  attachments?: PracticeAttachmentInput[];
} & Partial<LegacyMockExamInput>;

export type PracticeSessionResult = {
  id: number;
  practiceDate: string;
  testDate: string;
  section: PracticeSection;
  type: PracticeType;
  title: string | null;
  notes: string | null;
  parts: PartScore[];
  part1: LegacyPartScore | null;
  part2: LegacyPartScore | null;
  part3: LegacyPartScore | null;
  part4: LegacyPartScore | null;
  scenarios: ScenarioScore[];
  attachments: PracticeAttachment[];
};

function validateScore(label: string, score: { correct: number; total: number }) {
  if (!Number.isInteger(score.total) || score.total < 1) throw new Error(`${label}: 总题数必须至少为 1`);
  if (!Number.isInteger(score.correct) || score.correct < 0 || score.correct > score.total) {
    throw new Error(`${label}: 对题数必须在 0 到总题数之间`);
  }
}

function normalizeParts(input: PracticeSessionInput): PartScore[] {
  if (Array.isArray(input.parts)) {
    return input.parts.map((score) => ({ ...score }));
  }

  const legacyParts: Array<[1 | 2 | 3 | 4, LegacyPartScore | undefined]> = [
    [1, input.part1],
    [2, input.part2],
    [3, input.part3],
    [4, input.part4],
  ];
  return legacyParts
    .filter(([, score]) => score !== undefined)
    .map(([part, score]) => ({ part, correct: score!.correct, total: score!.total }));
}

const SECTION_PARTS: Record<PracticeSection, PartNumber[]> = {
  listening: [1, 2, 3, 4],
  reading: [5, 6, 7],
};

function inferSection(parts: PartScore[]): PracticeSection {
  return parts.length > 0 && parts.every((score) => score.part >= 5) ? 'reading' : 'listening';
}

function validateParts(parts: PartScore[], section: PracticeSection) {
  if (parts.length < 1) throw new Error('至少记录一个 Part 的成绩');
  const allowedParts = SECTION_PARTS[section];
  const seen = new Set<number>();
  for (const score of parts) {
    if (!allowedParts.includes(score.part)) {
      throw new Error(section === 'reading' ? '阅读练习只能记录 Part 5-7' : '听力练习只能记录 Part 1-4');
    }
    if (seen.has(score.part)) throw new Error(`Part ${score.part}: 不能重复记录`);
    seen.add(score.part);
    validateScore(`part${score.part}`, score);
  }
}

function validateAttachments(attachments: PracticeAttachmentInput[]) {
  if (attachments.length > 5) throw new Error('最多上传 5 张错题图片');
  for (const attachment of attachments) {
    if (!attachment.mimeType.startsWith('image/')) throw new Error('错题附件只能是图片');
    if (!attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`)) throw new Error('错题图片格式不正确');
    if (attachment.dataUrl.length > 3_500_000) throw new Error('单张错题图片不能超过约 2.5 MB');
  }
}

function rowPart(result: PracticeSessionResult, part: 1 | 2 | 3 | 4): LegacyPartScore | null {
  const score = result.parts.find((p) => p.part === part);
  return score ? { correct: score.correct, total: score.total } : null;
}

function buildResult(
  row: PracticeSessionRow,
  parts: PartScore[],
  scenarios: ScenarioScore[],
  attachments: PracticeAttachment[],
): PracticeSessionResult {
  const result: PracticeSessionResult = {
    id: row.id,
    practiceDate: row.practice_date,
    testDate: row.practice_date,
    section: row.section ?? 'listening',
    type: row.type,
    title: row.title,
    notes: row.notes,
    parts,
    part1: null,
    part2: null,
    part3: null,
    part4: null,
    scenarios,
    attachments,
  };
  result.part1 = rowPart(result, 1);
  result.part2 = rowPart(result, 2);
  result.part3 = rowPart(result, 3);
  result.part4 = rowPart(result, 4);
  return result;
}

export async function createMockExam(
  client: VercelClient,
  input: PracticeSessionInput,
): Promise<PracticeSessionResult> {
  const practiceDate = input.practiceDate ?? input.testDate;
  if (!practiceDate) throw new Error('练习日期必填');

  const parts = normalizeParts(input);
  const section = input.section ?? inferSection(parts);
  validateParts(parts, section);
  const scenarios = input.scenarios ?? [];
  scenarios.forEach((s, i) => validateScore(`scenario[${i}]`, s));
  const attachments = input.attachments ?? [];
  validateAttachments(attachments);

  const expectedParts = SECTION_PARTS[section];
  const hasCompleteSection = parts.length === expectedParts.length
    && expectedParts.every((part) => parts.some((score) => score.part === part));
  const type: PracticeType = input.type ?? (hasCompleteSection ? 'full_mock' : 'part_drill');
  if (type === 'full_mock' && !hasCompleteSection) {
    throw new Error(section === 'reading' ? '完整阅读需要记录 Part 5-7' : '完整模考需要记录 Part 1-4');
  }

  const { rows } = await client.query(
    `INSERT INTO practice_sessions (practice_date, section, type, title, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      practiceDate,
      section,
      type,
      input.title ?? (type === 'full_mock' ? (section === 'reading' ? '完整阅读' : '完整模考') : '专项训练'),
      input.notes ?? null,
    ],
  );
  const row = rows[0];

  for (const score of parts) {
    await client.query(
      `INSERT INTO practice_part_scores (practice_session_id, part, correct, total)
       VALUES ($1, $2, $3, $4)`,
      [row.id, score.part, score.correct, score.total],
    );
  }

  for (const s of scenarios) {
    await client.query(
      `INSERT INTO practice_scenario_scores (practice_session_id, scenario_major, scenario_minor, correct, total)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, s.scenarioMajor, s.scenarioMinor, s.correct, s.total],
    );
  }

  for (const attachment of attachments) {
    await client.query(
      `INSERT INTO practice_session_attachments (practice_session_id, name, mime_type, data_url)
       VALUES ($1, $2, $3, $4)`,
      [row.id, attachment.name, attachment.mimeType, attachment.dataUrl],
    );
  }

  return buildResult(row, parts, scenarios, attachments.map((attachment, index) => ({ ...attachment, id: index })));
}

export async function replacePracticeAttachments(
  client: VercelClient,
  practiceSessionId: number,
  attachments: PracticeAttachmentInput[],
): Promise<PracticeAttachment[]> {
  validateAttachments(attachments);
  const { rows: sessions } = await client.query('SELECT id FROM practice_sessions WHERE id = $1', [practiceSessionId]);
  if (sessions.length === 0) throw new Error('练习记录不存在');

  await client.query('DELETE FROM practice_session_attachments WHERE practice_session_id = $1', [practiceSessionId]);
  const saved: PracticeAttachment[] = [];
  for (const attachment of attachments) {
    const { rows } = await client.query(
      `INSERT INTO practice_session_attachments (practice_session_id, name, mime_type, data_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, mime_type, data_url`,
      [practiceSessionId, attachment.name, attachment.mimeType, attachment.dataUrl],
    );
    saved.push({ id: rows[0].id, name: rows[0].name, mimeType: rows[0].mime_type, dataUrl: rows[0].data_url });
  }
  return saved;
}

export async function resolvePracticeAttachmentInputs(
  client: VercelClient,
  practiceSessionId: number,
  attachments: PracticeAttachmentInput[],
): Promise<PracticeAttachmentInput[]> {
  const referencedIds = attachments.flatMap((attachment) => {
    const match = attachment.dataUrl.match(/^\/api\/mock-exams\/attachments\/(\d+)$/);
    return match ? [Number(match[1])] : [];
  });
  if (referencedIds.length === 0) {
    validateAttachments(attachments);
    return attachments;
  }

  const { rows } = await client.query<PracticeAttachmentRow>(
    `SELECT id, practice_session_id, name, mime_type, data_url
     FROM practice_session_attachments
     WHERE practice_session_id = $1 AND id = ANY($2::int[])`,
    [practiceSessionId, referencedIds],
  );
  const storedById = new Map(rows.map((row) => [row.id, row]));
  const resolved = attachments.map((attachment) => {
    const match = attachment.dataUrl.match(/^\/api\/mock-exams\/attachments\/(\d+)$/);
    if (!match) return attachment;
    const stored = storedById.get(Number(match[1]));
    if (!stored?.data_url) throw new Error('错题图片不存在或不属于这条练习记录');
    return { name: stored.name, mimeType: stored.mime_type, dataUrl: stored.data_url };
  });
  validateAttachments(resolved);
  return resolved;
}

export async function listMockExams(client: VercelClient): Promise<PracticeSessionResult[]> {
  const { rows } = await client.query<PracticeSessionRow>(
    'SELECT * FROM practice_sessions ORDER BY practice_date DESC, id DESC',
  );
  if (rows.length === 0) return [];

  const sessionIds = rows.map((row) => row.id);
  const { rows: partRows } = await client.query<PartScoreRow>(
    `SELECT practice_session_id, part, correct, total
     FROM practice_part_scores
     WHERE practice_session_id = ANY($1::int[])
     ORDER BY practice_session_id, part`,
    [sessionIds],
  );
  const { rows: scenarioRows } = await client.query<ScenarioScoreRow>(
    `SELECT practice_session_id, scenario_major, scenario_minor, correct, total
     FROM practice_scenario_scores
     WHERE practice_session_id = ANY($1::int[])
     ORDER BY practice_session_id, id`,
    [sessionIds],
  );
  const { rows: attachmentRows } = await client.query<PracticeAttachmentRow>(
    `SELECT id, practice_session_id, name, mime_type
     FROM practice_session_attachments
     WHERE practice_session_id = ANY($1::int[])
     ORDER BY practice_session_id, id`,
    [sessionIds],
  );

  const partsBySession = new Map<number, PartScore[]>();
  for (const score of partRows) {
    const scores = partsBySession.get(score.practice_session_id) ?? [];
    scores.push({ part: score.part, correct: score.correct, total: score.total });
    partsBySession.set(score.practice_session_id, scores);
  }

  const scenariosBySession = new Map<number, ScenarioScore[]>();
  for (const score of scenarioRows) {
    const scores = scenariosBySession.get(score.practice_session_id) ?? [];
    scores.push({
      scenarioMajor: score.scenario_major,
      scenarioMinor: score.scenario_minor,
      correct: score.correct,
      total: score.total,
    });
    scenariosBySession.set(score.practice_session_id, scores);
  }

  const attachmentsBySession = new Map<number, PracticeAttachment[]>();
  for (const attachment of attachmentRows) {
    const attachments = attachmentsBySession.get(attachment.practice_session_id) ?? [];
    attachments.push({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mime_type,
      dataUrl: practiceAttachmentUrl(attachment.id),
    });
    attachmentsBySession.set(attachment.practice_session_id, attachments);
  }

  return rows.map((row) => buildResult(
    row,
    partsBySession.get(row.id) ?? [],
    scenariosBySession.get(row.id) ?? [],
    attachmentsBySession.get(row.id) ?? [],
  ));
}
