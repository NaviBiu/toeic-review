import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db';
import { todayInShanghai } from '@/lib/dateUtils';
import {
  confirmReadingImport,
  ReadingImportError,
  verifyReadingImportToken,
} from '@/lib/readingNotes/importConfirm';

const bodySchema = z.object({
  token: z.string().min(1),
  acceptedSourceIndexes: z.array(z.number().int().nonnegative()),
}).strict();

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
    const client = createClient();
    await client.connect();
    try {
      const result = await confirmReadingImport(client, {
        candidates: payload.candidates,
        acceptedSourceIndexes: parsed.data.acceptedSourceIndexes,
        today: todayInShanghai(),
      });
      return NextResponse.json({
        ...result,
        message: `本次确认导入 ${result.requested} 条，新增成功 ${result.inserted} 条，新增分类 ${result.categoriesCreated} 个，跳过重复 ${result.duplicates} 条。`,
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    if (error instanceof ReadingImportError) {
      const status = error.kind === 'invalid' ? 400 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
