import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import { extractText, UnsupportedFileTypeError, FileTooLargeError } from '@/lib/fileExtract';
import { parseImportDocument, TruncatedAiResponseError } from '@/lib/importParser';
import { findMatch } from '@/lib/knowledgePoints';
import { decideDedup } from '@/lib/importDedup';
import { SCENARIOS } from '@/lib/scenarios';
import { todayInShanghai, isFutureDate } from '@/lib/dateUtils';

// A real multi-entry document (measured: ~30s for 20 entries) can exceed
// the platform's default function duration well before the AI finishes
// parsing -- found 2026-06-28 when a real upload silently produced no
// response. Vercel clamps this to whatever the actual plan allows, so
// requesting more than the account supports is harmless.
export const maxDuration = 60;

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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let candidates;
  try {
    candidates = await parseImportDocument(anthropic, rawText, today, SCENARIOS);
  } catch (err) {
    if (err instanceof TruncatedAiResponseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: '解析失败,请重试' }, { status: 502 });
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
