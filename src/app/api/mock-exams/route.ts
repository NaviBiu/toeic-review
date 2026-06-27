import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { createMockExam, listMockExams } from '@/lib/mockExams';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const client = createClient();
  await client.connect();
  try {
    const result = await createMockExam(client, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  } finally {
    await client.end();
  }
}

export async function GET() {
  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json(await listMockExams(client));
  } finally {
    await client.end();
  }
}
