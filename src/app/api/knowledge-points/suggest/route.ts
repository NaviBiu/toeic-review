import { NextRequest, NextResponse } from 'next/server';
import { suggestForTerm } from '@/lib/importParser';
import { createOpenAIClient } from '@/lib/openaiClient';
import { SCENARIOS } from '@/lib/scenarios';

export async function POST(req: NextRequest) {
  const { term, part } = await req.json();
  try {
    const openai = createOpenAIClient();
    const suggestion = await suggestForTerm(openai, term, part, SCENARIOS);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'AI 补全失败,请重试' }, { status: 502 });
  }
}
