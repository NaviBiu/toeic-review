import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { getPracticeAttachments, replacePracticeAttachments } from '@/lib/mockExams';

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '无效的练习记录 id' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    return NextResponse.json({ attachments: await getPracticeAttachments(client, id) });
  } finally {
    await client.end();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: '无效的练习记录 id' }, { status: 400 });

  const body = await req.json();
  if (!Array.isArray(body.attachments)) return NextResponse.json({ error: '附件格式不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const attachments = await replacePracticeAttachments(client, id, body.attachments);
    await client.query('COMMIT');
    return NextResponse.json({ attachments });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  } finally {
    await client.end();
  }
}
