import type OpenAI from 'openai';
import { z } from 'zod';
import { DEFAULT_DEEPSEEK_MODEL } from '@/lib/importParser';
import { normalizeReadingCategoryName } from './categories';
import { sanitizeReadingHtmlServer } from './richContent.server';
import type { ReadingImportCandidate } from './types';

const AiItemSchema = z.object({
  category: z.string().trim().min(1),
  contentHtml: z.string().min(1),
  notes: z.string().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const AiResponseSchema = z.object({ items: z.array(AiItemSchema) }).strict();

function systemPrompt(importDate: string) {
  return `你是 TOEIC 阅读笔记整理助手。把原始文本整理成可复习的知识点。
每条只输出分类、知识点 HTML、原文备注和日期。知识点可以包含段落、列表和表格，
不要补充原文不存在的解释。没有日期时使用 ${importDate}。
只返回 JSON：{"items":[{"category":"分类","contentHtml":"<p>知识点</p>","notes":null,"date":"${importDate}"}]}`;
}

export async function parseReadingImportWithAi(
  client: Pick<OpenAI, 'chat'>,
  plainText: string,
  importDate: string,
): Promise<ReadingImportCandidate[]> {
  const completion = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt(importDate) },
      { role: 'user', content: plainText },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    stream: false,
    thinking: { type: 'disabled' },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    thinking: { type: 'disabled' };
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error('AI 解析未返回内容');
  const parsed = AiResponseSchema.parse(JSON.parse(content));
  return parsed.items.map((item, sourceIndex) => {
    const category = normalizeReadingCategoryName(item.category);
    const sanitized = sanitizeReadingHtmlServer(item.contentHtml);
    return {
      sourceIndex,
      categoryName: category.name,
      contentHtml: sanitized.html,
      contentText: sanitized.text,
      notes: item.notes?.trim() || null,
      noteDate: item.date,
      confidence: 'high' as const,
      issue: null,
    };
  });
}
