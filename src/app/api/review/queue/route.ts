import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { getTodayQueue } from '@/lib/knowledgePoints';
import { todayInShanghai } from '@/lib/dateUtils';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const client = createClient();
  await client.connect();
  try {
    const queue = await getTodayQueue(client, todayInShanghai(), {
      scenarioMajor: searchParams.get('scenarioMajor') ?? undefined,
      scenarioMinor: searchParams.get('scenarioMinor') ?? undefined,
    });
    return NextResponse.json(queue);
  } finally {
    await client.end();
  }
}
