import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { applyConfirmedImportItem } from '@/lib/importConfirm';
import { todayInShanghai } from '@/lib/dateUtils';

export async function POST(req: NextRequest) {
  const { items } = await req.json();
  const today = todayInShanghai();
  const client = createClient();
  await client.connect();
  try {
    const results = [];
    for (const item of items) {
      try {
        const result = await applyConfirmedImportItem(client, item, today);
        results.push({ term: item.term, ...result });
      } catch (err: any) {
        results.push({ term: item.term, action: 'error', error: err.message });
      }
    }
    return NextResponse.json({ results });
  } finally {
    await client.end();
  }
}
