import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { applyReviewResult } from '@/lib/knowledgePoints';
import { todayInShanghai } from '@/lib/dateUtils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { correct } = await req.json();
  const client = createClient();
  await client.connect();
  try {
    const updated = await applyReviewResult(client, Number(id), !!correct, todayInShanghai());
    return NextResponse.json(updated);
  } finally {
    await client.end();
  }
}
