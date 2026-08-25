import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { getPracticeAttachment } from '@/lib/mockExams';

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const values = await params;
  const practiceSessionId = parseId(values.id);
  const attachmentId = parseId(values.attachmentId);
  if (!practiceSessionId || !attachmentId) {
    return NextResponse.json({ error: '无效的图片 id' }, { status: 400 });
  }

  const client = createClient();
  await client.connect();
  try {
    const attachment = await getPracticeAttachment(client, practiceSessionId, attachmentId);
    if (!attachment) return NextResponse.json({ error: '图片不存在' }, { status: 404 });

    const prefix = `data:${attachment.mimeType};base64,`;
    if (!attachment.dataUrl.startsWith(prefix)) {
      return NextResponse.json({ error: '图片数据格式不正确' }, { status: 500 });
    }
    const bytes = new Uint8Array(Buffer.from(attachment.dataUrl.slice(prefix.length), 'base64'));
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } finally {
    await client.end();
  }
}
