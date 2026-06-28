import type Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import { sanitizeScenario } from './scenarios';

export class TruncatedAiResponseError extends Error {}

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
- notes 只在笔记原文里有额外的"高频提示/用法说明"这类内容时才填,没有就填 null,不要自己编。笔记里标注的音标(IPA)也整理进 notes 里,不要为音标发明新的字段。
- 严格只使用 record_knowledge_points 工具定义的字段,不要新增字段(如音标单独成一个字段),也不要把 items 包装成字符串再返回,必须是真正的数组。
- dateAdded 用该条目所在的"时间:"标注日期,转成 YYYY-MM-DD;如果整篇笔记完全没有日期,用 ${fallbackDate}。
- scenarioMajor 必须是以下列表中的大类之一,scenarioMinor 必须是该大类下列出的细类之一,如果都拿不准就用"未分类":
${taxonomyText}
调用 record_knowledge_points 工具返回结果,不要输出额外文字。`;
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
const ENTRY_RE = /(^|\s)(\d{1,3}\.\s)/g;

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
    if (next && next.text.startsWith('1.')) {
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

// Confirmed against a real document: the model sometimes ignores the tool
// schema under load (observed on 3 of 8 real batches, all covering
// phonetic-transcription-heavy content) and returns `items` as a string
// containing JSON text instead of a true array, occasionally with `part`
// as "Part4" instead of the integer 4. Recover both rather than crash.
function normalizeItems(rawItems: unknown): any[] {
  let items = rawItems;
  if (typeof items === 'string') {
    // Confirmed against a real document: when the model falls back to
    // hand-writing `items` as a JSON-text string instead of a true array,
    // it sometimes forgets to escape a literal `"` that appears inside the
    // note's own text (e.g. a quoted term used for emphasis, like 此处不要
    // 理解成"文件备份" in the user's real notes) -- plain JSON.parse can't
    // recover from that, but jsonrepair specifically handles this exact
    // class of LLM JSON-generation mistake (unescaped quotes, trailing
    // commas, etc.) instead of requiring the string to already be valid.
    try {
      items = JSON.parse(jsonrepair(items));
    } catch {
      throw new Error('AI 解析失败,请重试');
    }
  }
  if (!Array.isArray(items)) {
    throw new Error('AI 解析失败,请重试');
  }
  return items;
}

function normalizePart(rawPart: unknown): number {
  if (typeof rawPart === 'number') return rawPart;
  if (typeof rawPart === 'string') {
    const match = rawPart.match(/[1-4]/);
    if (match) return Number(match[0]);
  }
  throw new Error('AI 解析失败,请重试');
}

async function parseChunk(
  client: Pick<Anthropic, 'messages'>,
  chunkText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: buildSystemPrompt(scenarioTaxonomy, fallbackDate),
    messages: [{ role: 'user', content: chunkText }],
    tools: [EXTRACT_TOOL as any],
    tool_choice: { type: 'tool', name: 'record_knowledge_points' },
  } as any);

  if ((response as any).stop_reason === 'max_tokens') {
    throw new TruncatedAiResponseError('笔记条目太多,AI 解析在生成结果时被截断,请减少单次上传的条目数量后重试');
  }

  const toolUse: any = (response as any).content.find((block: any) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI 解析失败,请重试');
  }
  const items = normalizeItems(toolUse.input.items);

  return items.map((item) => {
    const sanitized = sanitizeScenario(item.scenarioMajor, item.scenarioMinor);
    return {
      term: item.term,
      meaning: item.meaning,
      example: item.example,
      notes: item.notes ?? null,
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

// The schema-deviation that normalizeItems/normalizePart recover from is
// stochastic (the same content can succeed on a later attempt), so retrying
// a batch that still fails after recovery has a real chance of succeeding.
// TruncatedAiResponseError is the one exception -- that's a deterministic
// token-budget limit, not randomness, so retrying identical content would
// just truncate again at the same point.
const MAX_ATTEMPTS_PER_CHUNK = 3;

async function parseChunkWithRetry(
  client: Pick<Anthropic, 'messages'>,
  chunkText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK; attempt++) {
    try {
      return await parseChunk(client, chunkText, fallbackDate, scenarioTaxonomy);
    } catch (err) {
      if (err instanceof TruncatedAiResponseError) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export async function parseImportDocument(
  client: Pick<Anthropic, 'messages'>,
  rawText: string,
  fallbackDate: string,
  scenarioTaxonomy: Record<string, string[]>
): Promise<ParsedCandidate[]> {
  const chunks = splitIntoBatches(rawText);
  // No numbered entries detected (e.g. a single-term lookup from
  // suggestForTerm) -- fall back to sending the whole text as one chunk
  // rather than silently returning nothing.
  const effectiveChunks = chunks.length > 0 ? chunks : [rawText];
  const results = await Promise.all(
    effectiveChunks.map((chunk) => parseChunkWithRetry(client, chunk, fallbackDate, scenarioTaxonomy))
  );
  return results.flat();
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
