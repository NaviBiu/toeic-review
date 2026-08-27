import type OpenAI from 'openai';
import { z } from 'zod';
import { sanitizeScenario } from './scenarios';
import { normalizeTerm } from './termNormalize';

export class TruncatedAiResponseError extends Error {}

class RetryableAiResponseError extends Error {}

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

const PartSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.enum(['1', '2', '3', '4', 'Part1', 'Part2', 'Part3', 'Part4']),
]);

const ExtractedItemSchema = z.object({
  term: z.string(),
  meaning: z.string(),
  example: z.string(),
  notes: z.string().nullable(),
  part: PartSchema,
  dateAdded: z.string(),
  scenarioMajor: z.string(),
  scenarioMinor: z.string(),
  meaningWasAiGenerated: z.boolean(),
  exampleWasAiGenerated: z.boolean(),
});

const ExtractedItemsSchema = z.object({ items: z.array(ExtractedItemSchema) });

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

export function buildSystemPrompt(scenarioTaxonomy: Record<string, string[]>, fallbackDate: string): string {
  const taxonomyText = Object.entries(scenarioTaxonomy)
    .map(([major, minors]) => `${major}: ${minors.join('、') || '(无细类,仅用于无法归类时)'}`)
    .join('\n');
  return `你是一个帮用户整理 TOEIC 听力错题笔记的助手。把用户提供的原始笔记文本解析成结构化的知识点列表。
每条笔记通常按"Part几"标题分组,组内有一行"时间:YYYY.MM.DD",之后是编号的条目,每条是一个单词/短语,后面跟释义和补充说明。
规则:
- term 用笔记里写的原文。
- meaning/example 如果笔记里已经写了就照抄整理,如果没写就你自己生成,并把对应的 *WasAiGenerated 标成 true。
- notes 只在笔记原文里有额外的"高频提示/用法说明"这类内容时才填,没有就填 null,不要自己编。笔记里标注的音标(IPA)也整理进 notes 里,不要为音标发明新的字段。
- 严格只使用结构定义中的字段,不要新增字段(如音标单独成一个字段),items 必须是真正的数组。
- dateAdded 用该条目所在的"时间:"标注日期,转成 YYYY-MM-DD;如果整篇笔记完全没有日期,用 ${fallbackDate}。
- scenarioMajor 必须是以下列表中的大类之一,scenarioMinor 必须是该大类下列出的细类之一,如果都拿不准就用"未分类":
${taxonomyText}
只返回 JSON,不要输出 Markdown 或额外文字。JSON 必须严格使用以下结构:
{
  "items": [
    {
      "term": "英文词或短语",
      "meaning": "中文释义",
      "example": "英文例句",
      "notes": null,
      "part": 1,
      "dateAdded": "${fallbackDate}",
      "scenarioMajor": "未分类",
      "scenarioMinor": "未分类",
      "meaningWasAiGenerated": false,
      "exampleWasAiGenerated": false
    }
  ]
}`;
}

// A single AI call truncates well before a real day's volume: 4096 tokens
// truncated at 123 entries, and even 16000 still truncated the same
// document while taking 150s+ -- generation-bound, not fixable by raising
// the cap further without an unusably long wait. Confirmed 2026-06-28 that
// a single call comfortably handles ~20 entries (succeeded at 4096 tokens
// in production), so splitting into same-sized batches and calling the AI
// once per batch, in parallel, keeps each call inside its proven-safe
// range regardless of the total document size.
export const MAX_ENTRIES_PER_BATCH = 20;

// Real PDF extraction does not preserve line breaks at all -- confirmed
// against a real user document: pdfjs/unpdf returned the entire multi-Part,
// multi-date note as a single line with zero `\n` characters. A line-based
// split (the first version of this function) found zero entries in that
// case and silently fell back to treating the whole document as one
// unsplittable chunk, reproducing the exact truncation bug this function
// exists to prevent. Detecting markers by position in the flat text --
// rather than by line -- works whether or not real line breaks survive.
const DATE_RE = /时间\s*[:：]\s*[\d.\-/]+/g;
const PART_RE = /Part\s*[1-4]/gi;
// Captures the leading boundary (start-of-string or one whitespace char) so
// "...次 3. hang" and "3. hang" at a real line start are both matched the
// same way; the boundary char itself is excluded from the marker's range.
const ENTRY_RE = /(^|\s)(\d{1,3}(?:\.\s+|[，,、．]\s*(?=短\s*语\s*[：:])))/g;

type Marker = { type: 'date' | 'part' | 'entry'; start: number; text: string };

function findMarkers(text: string): Marker[] {
  const entryMarkers: Marker[] = [];
  ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(text))) {
    entryMarkers.push({ type: 'entry', start: m.index + m[1].length, text: m[2] });
  }

  const dateMarkers: Marker[] = [];
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(text))) {
    dateMarkers.push({ type: 'date', start: m.index, text: m[0] });
  }

  // A real "Part几" section header is always immediately followed by entry
  // "1." (each Part restarts its own numbering) -- real notes also mention
  // "Part1" casually inside an entry's own explanation (e.g. "hang 是
  // Part1 动作动词 TOP 级高频"), and without that check those incidental
  // mentions get misread as a new section header, truncating whatever
  // entry they appeared inside (confirmed against a real user document).
  const partMarkers: Marker[] = [];
  PART_RE.lastIndex = 0;
  while ((m = PART_RE.exec(text))) {
    const next = entryMarkers.find((e) => e.start > m!.index);
    if (next && /^1(?:\.|[，,、．])/.test(next.text)) {
      partMarkers.push({ type: 'part', start: m.index, text: m[0] });
    }
  }

  return [...dateMarkers, ...partMarkers, ...entryMarkers].sort((a, b) => a.start - b.start);
}

// Splits raw note text into self-contained chunks of at most
// MAX_ENTRIES_PER_BATCH numbered entries each, regardless of whether the
// text has real line breaks. Each entry's content runs from its own marker
// to the start of the next marker of any kind (or end of text), so
// multi-clause/wrapped entry text stays attached to the entry it belongs
// to. `时间`/`Part` markers persist across entries until the next
// occurrence of that same marker type -- a date applies to every Part
// section until a new date appears, even if that date line was never
// repeated for each Part.
export function splitIntoBatches(rawText: string, maxEntriesPerBatch = MAX_ENTRIES_PER_BATCH): string[] {
  const markers = findMarkers(rawText);

  type ParsedEntry = { text: string; date: string | null; part: string | null };
  const entries: ParsedEntry[] = [];
  let currentDate: string | null = null;
  let currentPart: string | null = null;

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker.type === 'date') {
      currentDate = marker.text;
    } else if (marker.type === 'part') {
      currentPart = marker.text;
    } else {
      const next = markers[i + 1];
      const end = next ? next.start : rawText.length;
      entries.push({ text: rawText.slice(marker.start, end).trim(), date: currentDate, part: currentPart });
    }
  }

  if (entries.length === 0) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < entries.length) {
    const { date, part } = entries[i];
    let j = i;
    while (j < entries.length && entries[j].date === date && entries[j].part === part) j++;
    const segmentEntries = entries.slice(i, j);
    const header = [date, part].filter((v): v is string => v != null).join('\n');
    for (let k = 0; k < segmentEntries.length; k += maxEntriesPerBatch) {
      const batch = segmentEntries.slice(k, k + maxEntriesPerBatch);
      chunks.push([header, ...batch.map((e) => e.text)].filter(Boolean).join('\n'));
    }
    i = j;
  }
  return chunks;
}

function normalizePart(rawPart: unknown): number {
  if (typeof rawPart === 'number' && Number.isInteger(rawPart) && rawPart >= 1 && rawPart <= 4) {
    return rawPart;
  }
  if (typeof rawPart === 'string') {
    const match = rawPart.match(/^(?:Part)?([1-4])$/i);
    if (match) return Number(match[1]);
  }
  throw new Error('AI 解析失败,请重试');
}

function extractLabeledSourceNotes(text: string): Map<string, string> {
  const markers = findMarkers(text);
  const notesByTerm = new Map<string, string>();

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker.type !== 'entry') continue;
    const end = markers[i + 1]?.start ?? text.length;
    const entry = text.slice(marker.start, end).trim();
    const termMatch = entry.match(/短\s*语\s*[：:]\s*([\s\S]*?)\s*短\s*语\s*翻\s*译\s*[：:]/);
    const analysisMatch = /考\s*点\s*分\s*析\s*[：:]\s*/.exec(entry);
    if (!termMatch || !analysisMatch) continue;

    const term = termMatch[1].replace(/\s+/g, ' ').trim();
    const analysis = entry.slice(analysisMatch.index + analysisMatch[0].length).trim();
    if (term && analysis) {
      notesByTerm.set(normalizeTerm(term), `考点分析：${analysis}`);
    }
  }

  return notesByTerm;
}

async function parseChunk(
  client: Pick<OpenAI, 'chat'>,
  chunkText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  const sourceNotes = extractLabeledSourceNotes(chunkText);
  const request = {
    model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(scenarioTaxonomy, fallbackDate) },
      { role: 'user', content: chunkText },
    ],
    stream: false,
    thinking: { type: 'disabled' },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    thinking: { type: 'disabled' };
  };
  const response = await client.chat.completions.create(request);

  const choice = response.choices[0];
  const finishReason = choice?.finish_reason as string | undefined;
  if (finishReason === 'length') {
    throw new TruncatedAiResponseError('笔记条目太多,AI 解析在生成结果时被截断,请减少单次上传的条目数量后重试');
  }
  if (finishReason === 'content_filter') {
    throw new Error('AI 拒绝处理这份笔记,请调整内容后重试');
  }
  if (finishReason === 'insufficient_system_resource') {
    throw new Error('DeepSeek 服务繁忙,请稍后重试');
  }

  const content = choice?.message.content?.trim();
  if (!content) {
    throw new RetryableAiResponseError('AI 解析失败,请重试');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new RetryableAiResponseError('AI 解析失败,请重试');
  }

  const parsed = ExtractedItemsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new RetryableAiResponseError('AI 解析失败,请重试');
  }
  const items = parsed.data.items;

  return items.map((item) => {
    const sanitized = sanitizeScenario(item.scenarioMajor, item.scenarioMinor);
    return {
      term: item.term,
      meaning: item.meaning,
      example: item.example,
      notes: sourceNotes.get(normalizeTerm(item.term)) ?? item.notes ?? null,
      part: normalizePart(item.part),
      dateAdded: item.dateAdded,
      scenarioMajor: sanitized.major,
      scenarioMinor: sanitized.minor,
      scenarioWasSanitized: sanitized.major !== item.scenarioMajor || sanitized.minor !== item.scenarioMinor,
      meaningWasAiGenerated: !!item.meaningWasAiGenerated,
      exampleWasAiGenerated: !!item.exampleWasAiGenerated,
    };
  });
}

// A completed response without parsed output can succeed on a later attempt.
const MAX_ATTEMPTS_PER_CHUNK = 3;

async function parseChunkWithRetry(
  client: Pick<OpenAI, 'chat'>,
  chunkText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>,
  maxAttempts = MAX_ATTEMPTS_PER_CHUNK,
): Promise<ParsedCandidate[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await parseChunk(client, chunkText, fallbackDate, scenarioTaxonomy);
    } catch (err) {
      if (err instanceof TruncatedAiResponseError) throw err;
      if (!(err instanceof RetryableAiResponseError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export async function parseImportDocument(
  client: Pick<OpenAI, 'chat'>,
  rawText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>,
  maxAttempts = MAX_ATTEMPTS_PER_CHUNK,
): Promise<ParsedCandidate[]> {
  const chunks = splitIntoBatches(rawText);
  // No numbered entries detected (e.g. a single-term lookup from
  // suggestForTerm) -- fall back to sending the whole text as one chunk
  // rather than silently returning nothing.
  const effectiveChunks = chunks.length > 0 ? chunks : [rawText];
  const results = await Promise.all(
    effectiveChunks.map((chunk) => (
      parseChunkWithRetry(client, chunk, fallbackDate, scenarioTaxonomy, maxAttempts)
    ))
  );
  return results.flat();
}

export async function suggestForTerm(
  client: Pick<OpenAI, 'chat'>,
  term: string,
  part: number,
  scenarioTaxonomy: Record<string, string[]>
): Promise<{ meaning: string; example: string; scenarioMajor: string; scenarioMinor: string }> {
  const fakeNote = `Part${part}\n时间:2026-01-01\n1. ${term}`;
  const [first] = await parseImportDocument(client, fakeNote, '2026-01-01', scenarioTaxonomy, 1);
  return {
    meaning: first.meaning,
    example: first.example,
    scenarioMajor: first.scenarioMajor,
    scenarioMinor: first.scenarioMinor,
  };
}
