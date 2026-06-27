import { NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { getKnowledgePointStats } from '@/lib/stats';

export async function GET() {
  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await getKnowledgePointStats(client));
  } finally {
    await client.end();
  }
}
