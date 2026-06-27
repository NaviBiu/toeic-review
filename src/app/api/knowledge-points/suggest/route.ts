import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { suggestForTerm } from '@/lib/importParser';
import { SCENARIOS } from '@/lib/scenarios';

export async function POST(req: NextRequest) {
  const { term, part } = await req.json();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const suggestion = await suggestForTerm(anthropic, term, part, SCENARIOS);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'AI 补全失败,请重试' }, { status: 502 });
  }
}
