import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { updateKnowledgePointFields, softDeleteKnowledgePoint, markKnowledgePointMastered, restoreKnowledgePoint } from '@/lib/knowledgePoints';
import { isValidScenario } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  const body = await req.json();
  const client = createClient();
  await client.connect();
  try {
    if (body.status === 'deleted') {
      return NextResponse.json(await softDeleteKnowledgePoint(client, id));
    }
    if (body.status === 'mastered') {
      return NextResponse.json(await markKnowledgePointMastered(client, id));
    }
    if (body.status === 'active') {
      return NextResponse.json(await restoreKnowledgePoint(client, id, todayInShanghai()));
    }
    if (body.scenarioMajor && body.scenarioMinor && !isValidScenario(body.scenarioMajor, body.scenarioMinor)) {
      return NextResponse.json({ error: '场景分类不在允许的列表内' }, { status: 400 });
    }
    if (body.dateAdded && isFutureDate(body.dateAdded, todayInShanghai())) {
      return NextResponse.json({ error: '学习日期不能晚于今天' }, { status: 400 });
    }
    const { status, ...fields } = body;
    const updated = await updateKnowledgePointFields(client, id, fields);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  } finally {
    await client.end();
  }
}
