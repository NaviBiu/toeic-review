import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseImportDocument, suggestForTerm, splitIntoBatches } from '../../src/lib/importParser';
import { SCENARIOS } from '../../src/lib/scenarios';

function entries(n: number, start = 1) {
  return Array.from({ length: n }, (_, i) => `${start + i}. term${start + i} 释义说明`).join('\n');
}

// Real PDF extraction collapses everything to one line with no `\n` at all
// (confirmed against a real user document) -- this helper builds the same
// entries joined by plain spaces instead, the worst case splitIntoBatches
// has to handle.
function flatEntries(n: number, start = 1) {
  return Array.from({ length: n }, (_, i) => `${start + i}. term${start + i} 释义说明`).join(' ');
}

describe('buildSystemPrompt', () => {
  it('includes every scenario major in the prompt', () => {
    const prompt = buildSystemPrompt(SCENARIOS, '2026-06-26');
    for (const major of Object.keys(SCENARIOS)) {
      expect(prompt).toContain(major);
    }
  });
});

describe('parseImportDocument', () => {
  function fakeClient(items: any[]) {
    return {
      messages: { create: async () => ({ content: [{ type: 'tool_use', input: { items } }] }) },
    } as any;
  }

  it('maps a well-formed tool response into ParsedCandidate objects', async () => {
    const client = fakeClient([{
      term: 'workshop', meaning: '研讨会', example: "supervisors' workshop", notes: null,
      part: 2, dateAdded: '2026-06-23', scenarioMajor: '一般商务', scenarioMinor: '会议',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('workshop');
    expect(result[0].scenarioWasSanitized).toBe(false);
  });

  it('sanitizes a hallucinated scenario minor and flags it', async () => {
    const client = fakeClient([{
      term: 'invest', meaning: '投资', example: 'ex', notes: null,
      part: 3, dateAdded: '2026-06-23', scenarioMajor: '金融/预算', scenarioMinor: '股票交易',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result[0].scenarioMinor).toBe('未分类');
    expect(result[0].scenarioWasSanitized).toBe(true);
  });

  it('throws a friendly error when the AI does not return a tool_use block', async () => {
    const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'oops' }] }) } } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
  });

  // Confirmed against a real document, 2026-06-28: the model sometimes
  // ignores the tool schema under load and returns `items` as a JSON
  // string instead of a real array, with `part` as "Part4" instead of 4.
  it('recovers when items comes back as a JSON-encoded string instead of a real array', async () => {
    const itemsAsString = JSON.stringify([{
      term: 'venue', meaning: '场馆', example: 'The venue is downtown.', notes: null,
      part: 'Part4', dateAdded: '2026-06-27', scenarioMajor: '娱乐', scenarioMinor: '剧场',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);
    const client = fakeClient(itemsAsString as any);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('venue');
    expect(result[0].part).toBe(4); // "Part4" normalized to the integer 4
  });

  // Root cause confirmed against the user's real document on 2026-06-28: when
  // the model hand-writes `items` as a string instead of a true array, it
  // sometimes forgets to escape a literal `"` that appears inside the
  // note's own content (e.g. a quoted term used for Chinese-style emphasis,
  // such as 此处不要理解成"文件备份" in the real notes) -- plain JSON.parse
  // cannot recover from that broken escaping, jsonrepair can.
  it('recovers items-as-a-string even when it contains an unescaped quote inside a value (jsonrepair, not plain JSON.parse)', async () => {
    const itemsAsStringWithBadEscaping =
      '[{"term":"back up","meaning":"设备恢复运转，此处不是"文件备份"","example":"It will be back up in 45 minutes.","notes":null,"part":3,"dateAdded":"2026-06-27","scenarioMajor":"金融/预算","scenarioMinor":"银行业务","meaningWasAiGenerated":false,"exampleWasAiGenerated":false}]';
    const client = fakeClient(itemsAsStringWithBadEscaping as any);
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('back up');
    expect(result[0].meaning).toContain('文件备份');
  });

  it('throws a friendly error when items is a string that is not valid JSON even after repair', async () => {
    const client = fakeClient('not json at all' as any);
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
  });

  it('retries a chunk that fails validation and succeeds once the AI returns a real array', async () => {
    let callCount = 0;
    const client = {
      messages: {
        create: async () => {
          callCount++;
          if (callCount < 3) {
            // First two attempts: schema deviation (string instead of array).
            return { content: [{ type: 'tool_use', input: { items: 'still not an array' } }] };
          }
          return {
            content: [{ type: 'tool_use', input: { items: [{
              term: 'venue', meaning: '场馆', example: 'ex', notes: null, part: 4,
              dateAdded: '2026-06-27', scenarioMajor: '娱乐', scenarioMinor: '剧场',
              meaningWasAiGenerated: false, exampleWasAiGenerated: false,
            }] } }],
          };
        },
      },
    } as any;
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(callCount).toBe(3);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('venue');
  });

  it('gives up after 3 attempts if the AI never returns a valid array', async () => {
    let callCount = 0;
    const client = {
      messages: { create: async () => { callCount++; return { content: [{ type: 'tool_use', input: { items: 'never valid' } }] }; } },
    } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
    expect(callCount).toBe(3);
  });

  it('does not retry a TruncatedAiResponseError -- the same content would truncate again deterministically', async () => {
    let callCount = 0;
    const client = {
      messages: { create: async () => { callCount++; return { stop_reason: 'max_tokens', content: [] }; } },
    } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('被截断');
    expect(callCount).toBe(1);
  });
});

describe('splitIntoBatches', () => {
  it('keeps a single small segment as one chunk, context included', () => {
    const text = `时间：2026.06.28\nPart3\n${entries(5)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Part3');
    expect(chunks[0]).toContain('时间：2026.06.28');
    expect(chunks[0]).toContain('1. term1');
    expect(chunks[0]).toContain('5. term5');
  });

  it('splits one segment into multiple batches and repeats its context on every batch', () => {
    const text = `时间：2026.06.28\nPart3\n${entries(45)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(3); // 20 + 20 + 5
    for (const chunk of chunks) {
      expect(chunk).toContain('Part3');
      expect(chunk).toContain('时间：2026.06.28');
    }
    expect(chunks[0]).toContain('1. term1');
    expect(chunks[0]).toContain('20. term20');
    expect(chunks[0]).not.toContain('21. term21');
    expect(chunks[1]).toContain('21. term21');
    expect(chunks[1]).toContain('40. term40');
    expect(chunks[2]).toContain('41. term41');
    expect(chunks[2]).toContain('45. term45');
  });

  it('keeps each Part section in its own chunk with its own context, not mixed together', () => {
    const text = `时间：2026.06.27\nPart1\n${entries(3)}\nPart2\n${entries(3, 1)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('Part1');
    expect(chunks[0]).toContain('2026.06.27');
    expect(chunks[0]).not.toContain('Part2');
    expect(chunks[1]).toContain('Part2');
    expect(chunks[1]).toContain('2026.06.27'); // date persists across Part changes, it isn't repeated per Part
    expect(chunks[1]).not.toContain('Part1');
  });

  it('carries a date forward across multiple Part sections that never repeat the 时间 line', () => {
    // Matches a real document's actual structure: one 时间 line at the top,
    // then four Part sections that each only restate their own header.
    const text = `时间：2026.06.27\nPart1\n${entries(2)}\nPart2\n${entries(2, 1)}\nPart3\n${entries(2, 1)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk).toContain('2026.06.27');
  });

  it('updates to a second date for sections that follow it, without disturbing earlier sections', () => {
    const text = `时间：2026.06.27\nPart1\n${entries(2)}\n时间：2026.06.28\nPart1\n${entries(2, 1)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('2026.06.27');
    expect(chunks[0]).not.toContain('2026.06.28');
    expect(chunks[1]).toContain('2026.06.28');
    expect(chunks[1]).not.toContain('2026.06.27');
  });

  it('does not split a document at the start of a new line -- splitIntoBatches works on raw text directly, not pre-split lines', () => {
    // Same content as the multi-section test above, but with zero `\n` at
    // all -- the documented real-world case for PDF-extracted text.
    const text = `时间：2026.06.27 Part1 ${flatEntries(2)} Part2 ${flatEntries(2, 1)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('Part1');
    expect(chunks[0]).toContain('1. term1');
    expect(chunks[1]).toContain('Part2');
    expect(chunks[1]).toContain('1. term1'); // Part2's own entry 1, numbering restarts
  });

  it('does not mistake "Part1" mentioned inside an entry\'s own text for a new section header', () => {
    // Confirmed against a real user document: an entry's own explanation
    // casually says "...hang 是 Part1 动作动词 TOP 级高频..." -- without the
    // "next entry-marker must be 1." check, this truncated that entry right
    // at the incidental "Part1" mention.
    const text = `时间：2026.06.27\nPart1\n1. fold arms 释义\n2. hang 是 Part1 动作动词高频\n3. ladder 梯子`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('2. hang 是 Part1 动作动词高频');
    expect(chunks[0]).toContain('3. ladder 梯子');
  });

  it('ignores blank lines between entries instead of treating them as a new segment', () => {
    const text = `时间：2026.06.28\nPart3\n\n1. term1 释义\n\n2. term2 释义\n\n`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('1. term1');
    expect(chunks[0]).toContain('2. term2');
    expect(chunks[0]).toContain('Part3');
  });

  it('returns no chunks for text with no numbered entries', () => {
    expect(splitIntoBatches('just some prose with no list')).toEqual([]);
  });
});

describe('parseImportDocument batching', () => {
  it('calls the AI once per batch and merges all results, for a document over the batch size', async () => {
    let callCount = 0;
    const client = {
      messages: {
        create: async (params: any) => {
          callCount++;
          // Echo back one item per numbered entry line actually present in this call's content.
          const lines = (params.messages[0].content as string).split('\n').filter((l: string) => /^\d+\./.test(l));
          return {
            content: [{
              type: 'tool_use',
              input: {
                items: lines.map((l: string, i: number) => ({
                  term: `t${callCount}-${i}`, meaning: 'm', example: 'e', notes: null, part: 1,
                  dateAdded: '2026-06-28', scenarioMajor: '未分类', scenarioMinor: '未分类',
                  meaningWasAiGenerated: false, exampleWasAiGenerated: false,
                })),
              },
            }],
          };
        },
      },
    } as any;
    const text = `Part1\n时间:2026.06.28\n${entries(45)}`;
    const result = await parseImportDocument(client, text, '2026-06-28', SCENARIOS);
    expect(callCount).toBe(3); // 45 entries / 20 per batch -> 3 calls
    expect(result).toHaveLength(45); // all batches' results merged
  });
});

describe('suggestForTerm', () => {
  it('wraps the term in a single-item note and returns the parsed suggestion', async () => {
    const client = {
      messages: {
        create: async (params: any) => {
          expect(params.messages[0].content).toContain('workshop');
          return {
            content: [{ type: 'tool_use', input: { items: [{
              term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
              dateAdded: '2026-01-01', scenarioMajor: '一般商务', scenarioMinor: '会议',
              meaningWasAiGenerated: true, exampleWasAiGenerated: true,
            }] } }],
          };
        },
      },
    } as any;
    const result = await suggestForTerm(client, 'workshop', 2, SCENARIOS);
    expect(result).toEqual({ meaning: '研讨会', example: 'ex', scenarioMajor: '一般商务', scenarioMinor: '会议' });
  });
});
