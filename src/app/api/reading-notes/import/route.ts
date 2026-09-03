import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import { parseReadingDocx, validateReadingDocx } from '@/lib/readingNotes/docxParser';
import { buildReadingImportPreview, ReadingImportError } from '@/lib/readingNotes/importConfirm';

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: '上传内容格式不正确' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    validateReadingDocx({ name: file.name, size: file.size, buffer });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '文件格式不正确',
    }, { status: 400 });
  }

  const secret = process.env.AUTH_SECRET ?? '';
  if (!secret) {
    return NextResponse.json({ error: '服务器未配置导入签名密钥' }, { status: 500 });
  }
  try {
    const candidates = await parseReadingDocx(buffer, todayInShanghai());
    const client = createClient();
    await client.connect();
    try {
      return NextResponse.json(await buildReadingImportPreview(client, candidates, secret));
    } finally {
      await client.end();
    }
  } catch (error) {
    if (error instanceof ReadingImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Word 解析失败，请检查文档格式后重试' }, { status: 400 });
  }
}
