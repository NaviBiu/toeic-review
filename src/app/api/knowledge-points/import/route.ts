import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import { extractText, UnsupportedFileTypeError, FileTooLargeError } from '@/lib/fileExtract';
import { parseImportDocument, TruncatedAiResponseError } from '@/lib/importParser';
import { createOpenAIClient } from '@/lib/openaiClient';
import { findMatch } from '@/lib/knowledgePoints';
import { decideDedup } from '@/lib/importDedup';
import { SCENARIOS } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

// A real multi-Part, multi-date document's total latency varies a lot run
// to run (measured in production: 48s-63s+ for the same 8-batch document),
// and 60s was cutting it close enough to cause an outright 504 on a real
// attempt. Testing whether Vercel's real ceiling for this account is
// actually higher than 60 -- requesting more than the account supports is
// harmless, Vercel clamps it.
export const maxDuration = 300;

function getAiFailureDetails(err: unknown): {
  userMessage: string;
  log: { name: string; status: number | null; code: string | null; message: string };
} {
  const error = err as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  const name = typeof error?.name === 'string' ? error.name : 'UnknownError';
  const status = typeof error?.status === 'number' ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = typeof error?.message === 'string' ? error.message.slice(0, 500) : String(err).slice(0, 500);
  const normalizedMessage = message.toLowerCase();

  let userMessage = 'AI 解析失败，请稍后重试';
  if (/missing credentials|openai_api_key.*environment variable/.test(normalizedMessage)) {
    userMessage = 'OpenAI API 尚未配置，请先设置 OPENAI_API_KEY';
  } else if (
    code === 'insufficient_quota'
    || status === 402
    || /current quota|insufficient quota|credit balance|billing|payment required/.test(normalizedMessage)
  ) {
    userMessage = 'OpenAI API 余额不足或已达到使用限额，请检查计费和用量设置';
  } else if (status === 401 || status === 403) {
    userMessage = 'OpenAI API 密钥无效或权限不足，请更新密钥后重试';
  } else if (status === 429) {
    userMessage = 'OpenAI API 请求过于频繁，请稍后重试';
  } else if (status != null && status >= 500) {
    userMessage = 'OpenAI API 服务暂时不可用，请稍后再试';
  }

  return { userMessage, log: { name, status, code, message } };
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const today = todayInShanghai();

  let rawText: string;
  try {
    rawText = await extractText(file.name, buffer);
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError || err instanceof FileTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let candidates;
  try {
    const openai = createOpenAIClient();
    candidates = await parseImportDocument(openai, rawText, today, SCENARIOS);
  } catch (err) {
    if (err instanceof TruncatedAiResponseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const failure = getAiFailureDetails(err);
    console.error('AI import parsing failed', failure.log);
    return NextResponse.json({ error: failure.userMessage }, { status: 502 });
  }

  const client = createClient();
  await client.connect();
  try {
    const withDecisions = [];
    for (const candidate of candidates) {
      const safeDate = isFutureDate(candidate.dateAdded, today) ? today : candidate.dateAdded;
      const existing = await findMatch(client, candidate.term, candidate.part, candidate.scenarioMajor, candidate.scenarioMinor, 'listening');
      const decision = decideDedup(
        { dateAdded: safeDate, meaning: candidate.meaning, example: candidate.example, notes: candidate.notes },
        existing ? { status: existing.status, dateAdded: existing.dateAdded, meaning: existing.meaning, example: existing.example, notes: existing.notes } : null
      );
      withDecisions.push({
        ...candidate,
        dateAdded: safeDate,
        dateWasClampedToToday: safeDate !== candidate.dateAdded,
        decision,
        existingId: existing?.id ?? null,
      });
    }
    return NextResponse.json({ candidates: withDecisions });
  } finally {
    await client.end();
  }
}
