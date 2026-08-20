import { NextRequest, NextResponse } from 'next/server';
import { suggestForTerm } from '@/lib/importParser';
import { createDeepSeekClient } from '@/lib/deepseekClient';
import { SCENARIOS } from '@/lib/scenarios';

export async function POST(req: NextRequest) {
  const { term, part } = await req.json();
  try {
    const deepseek = createDeepSeekClient();
    const suggestion = await suggestForTerm(deepseek, term, part, SCENARIOS);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'AI 补全失败,请重试' }, { status: 502 });
  }
}
