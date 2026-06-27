import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { applyReviewResult } from '@/lib/knowledgePoints';
import { todayInShanghai } from '@/lib/dateUtils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return NextResponse.json({ error: '无效的知识点 id' }, { status: 400 });
  }

  let correct: unknown;
  try {
    ({ correct } = await req.json());
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    const updated = await applyReviewResult(client, numericId, !!correct, todayInShanghai());
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  } finally {
    await client.end();
  }
}
