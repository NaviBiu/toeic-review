import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { replacePracticeAttachments } from '@/lib/mockExams';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: '无效的练习记录 id' }, { status: 400 });

  const body = await req.json();
  if (!Array.isArray(body.attachments)) return NextResponse.json({ error: '附件格式不正确' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const attachments = await replacePracticeAttachments(client, id, body.attachments);
    await client.query('COMMIT');
    return NextResponse.json({ attachments });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: err.message }, { status: 400 });
  } finally {
    await client.end();
  }
}
