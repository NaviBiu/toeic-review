import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { insertKnowledgePoint, listKnowledgePoints } from '@/lib/knowledgePoints';
import { isValidScenario } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const scenarioMajor = body.scenarioMajor ?? '未分类';
  const scenarioMinor = body.scenarioMinor ?? '未分类';
  if (!isValidScenario(scenarioMajor, scenarioMinor)) {
    return NextResponse.json({ error: '场景分类不在允许的列表内' }, { status: 400 });
  }
  const today = todayInShanghai();
  const dateAdded = body.dateAdded && !isFutureDate(body.dateAdded, today) ? body.dateAdded : today;

  const client = createClient();
  await client.connect();
  try {
    const kp = await insertKnowledgePoint(client, {
      term: body.term,
      meaning: body.meaning ?? '',
      example: body.example ?? '',
      notes: body.notes ?? null,
      part: body.part,
      scenarioMajor,
      scenarioMinor,
      skill: 'listening',
      dateAdded,
    });
    return NextResponse.json(kp, { status: 201 });
  } finally {
    await client.end();
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const client = createClient();
  await client.connect();
  try {
    const results = await listKnowledgePoints(client, {
      part: searchParams.get('part') ? Number(searchParams.get('part')) : undefined,
      scenarioMajor: searchParams.get('scenarioMajor') ?? undefined,
      scenarioMinor: searchParams.get('scenarioMinor') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    return NextResponse.json(results);
  } finally {
    await client.end();
  }
}
