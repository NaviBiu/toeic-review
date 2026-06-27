import type Anthropic from '@anthropic-ai/sdk';
import { sanitizeScenario } from './scenarios';

export type ParsedCandidate = {
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  dateAdded: string;
  scenarioMajor: string;
  scenarioMinor: string;
  scenarioWasSanitized: boolean;
  meaningWasAiGenerated: boolean;
  exampleWasAiGenerated: boolean;
};

const EXTRACT_TOOL = {
  name: 'record_knowledge_points',
  description: '记录从笔记中解析出的 TOEIC 听力知识点',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            meaning: { type: 'string' },
            example: { type: 'string' },
            notes: { type: ['string', 'null'] },
            part: { type: 'integer', enum: [1, 2, 3, 4] },
            dateAdded: { type: 'string' },
            scenarioMajor: { type: 'string' },
            scenarioMinor: { type: 'string' },
            meaningWasAiGenerated: { type: 'boolean' },
            exampleWasAiGenerated: { type: 'boolean' },
          },
          required: [
            'term', 'meaning', 'example', 'notes', 'part', 'dateAdded',
            'scenarioMajor', 'scenarioMinor', 'meaningWasAiGenerated', 'exampleWasAiGenerated',
          ],
        },
      },
    },
    required: ['items'],
  },
};

export function buildSystemPrompt(scenarioTaxonomy: Record<string, string[]>, fallbackDate: string): string {
  const taxonomyText = Object.entries(scenarioTaxonomy)
    .map(([major, minors]) => `${major}: ${minors.join('、') || '(无细类,仅用于无法归类时)'}`)
    .join('\n');
  return `你是一个帮用户整理 TOEIC 听力错题笔记的助手。把用户提供的原始笔记文本解析成结构化的知识点列表。
每条笔记通常按"Part几"标题分组,组内有一行"时间:YYYY.MM.DD",之后是编号的条目,每条是一个单词/短语,后面跟释义和补充说明。
规则:
- term 用笔记里写的原文。
- meaning/example 如果笔记里已经写了就照抄整理,如果没写就你自己生成,并把对应的 *WasAiGenerated 标成 true。
- notes 只在笔记原文里有额外的"高频提示/用法说明"这类内容时才填,没有就填 null,不要自己编。
- dateAdded 用该条目所在的"时间:"标注日期,转成 YYYY-MM-DD;如果整篇笔记完全没有日期,用 ${fallbackDate}。
- scenarioMajor 必须是以下列表中的大类之一,scenarioMinor 必须是该大类下列出的细类之一,如果都拿不准就用"未分类":
${taxonomyText}
调用 record_knowledge_points 工具返回结果,不要输出额外文字。`;
}

export async function parseImportDocument(
  client: Pick<Anthropic, 'messages'>,
  rawText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: buildSystemPrompt(scenarioTaxonomy, fallbackDate),
    messages: [{ role: 'user', content: rawText }],
    tools: [EXTRACT_TOOL as any],
    tool_choice: { type: 'tool', name: 'record_knowledge_points' },
  } as any);

  const toolUse: any = (response as any).content.find((block: any) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI 解析失败,请重试');
  }
  const items = toolUse.input.items as any[];

  return items.map((item) => {
    const sanitized = sanitizeScenario(item.scenarioMajor, item.scenarioMinor);
    return {
      term: item.term,
      meaning: item.meaning,
      example: item.example,
      notes: item.notes ?? null,
      part: item.part,
      dateAdded: item.dateAdded,
      scenarioMajor: sanitized.major,
      scenarioMinor: sanitized.minor,
      scenarioWasSanitized: sanitized.major !== item.scenarioMajor || sanitized.minor !== item.scenarioMinor,
      meaningWasAiGenerated: !!item.meaningWasAiGenerated,
      exampleWasAiGenerated: !!item.exampleWasAiGenerated,
    };
  });
}

export async function suggestForTerm(
  client: Pick<Anthropic, 'messages'>,
  term: string,
  part: number,
  scenarioTaxonomy: Record<string, string[]>
): Promise<{ meaning: string; example: string; scenarioMajor: string; scenarioMinor: string }> {
  const fakeNote = `Part${part}\n时间:2026-01-01\n1. ${term}`;
  const [first] = await parseImportDocument(client, fakeNote, '2026-01-01', scenarioTaxonomy);
  return {
    meaning: first.meaning,
    example: first.example,
    scenarioMajor: first.scenarioMajor,
    scenarioMinor: first.scenarioMinor,
  };
}
