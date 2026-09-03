import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDeepSeekClient } from '@/lib/deepseekClient';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import { parseReadingImportWithAi } from '@/lib/readingNotes/aiParser';
import {
  buildReadingImportPreview,
  ReadingImportError,
  verifyReadingImportToken,
} from '@/lib/readingNotes/importConfirm';

export const maxDuration = 60;

const bodySchema = z.object({ token: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const secret = process.env.AUTH_SECRET ?? '';
  if (!secret) {
    return NextResponse.json({ error: '服务器未配置导入签名密钥' }, { status: 500 });
  }

  try {
    const payload = verifyReadingImportToken(parsed.data.token, secret);
    const plainText = payload.candidates.map((candidate) => (
      `日期：${candidate.noteDate}\n分类：${candidate.categoryName}\n知识点：${candidate.contentText}${
        candidate.notes ? `\n备注：${candidate.notes}` : ''
      }`
    )).join('\n\n');
    const candidates = await parseReadingImportWithAi(
      createDeepSeekClient(),
      plainText,
      todayInShanghai(),
    );
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
    console.error('Reading note AI import failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    return NextResponse.json({ error: 'DeepSeek 解析失败，请稍后重试' }, { status: 502 });
  }
}
