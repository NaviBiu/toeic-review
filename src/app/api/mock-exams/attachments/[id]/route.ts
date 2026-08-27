import { NextResponse } from 'next/server';
import { createClient } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: '无效的图片 id' }, { status: 400 });

  const client = createClient();
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT mime_type, data_url FROM practice_session_attachments WHERE id = $1`,
      [id],
    );
    const attachment = rows[0];
    if (!attachment) return NextResponse.json({ error: '图片不存在' }, { status: 404 });
    const prefix = `data:${attachment.mime_type};base64,`;
    if (!attachment.data_url.startsWith(prefix)) return NextResponse.json({ error: '图片数据损坏' }, { status: 500 });

    return new NextResponse(Buffer.from(attachment.data_url.slice(prefix.length), 'base64'), {
      headers: {
        'Content-Type': attachment.mime_type,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } finally {
    await client.end();
  }
}
