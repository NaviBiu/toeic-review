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

function jsonCompletion(value: unknown, finishReason = 'stop') {
  return {
    choices: [{
      finish_reason: finishReason,
      message: { content: value == null ? null : JSON.stringify(value) },
    }],
  };
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
      chat: { completions: { create: async () => jsonCompletion({ items }) } },
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

  it('throws a friendly error when the AI does not return parsed structured output', async () => {
    const client = { chat: { completions: { create: async () => jsonCompletion(null) } } } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
  });

  it('retries a chunk that has no parsed output and succeeds on a later response', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount++;
          if (callCount < 3) {
            return jsonCompletion(null);
          }
          return jsonCompletion({ items: [{
              term: 'venue', meaning: '场馆', example: 'ex', notes: null, part: 4,
              dateAdded: '2026-06-27', scenarioMajor: '娱乐', scenarioMinor: '剧场',
              meaningWasAiGenerated: false, exampleWasAiGenerated: false,
            }] });
        } },
      },
    } as any;
    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(callCount).toBe(3);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('venue');
  });

  it('gives up after 3 attempts if the AI never returns parsed output', async () => {
    let callCount = 0;
    const client = {
      chat: { completions: { create: async () => { callCount++; return jsonCompletion(null); } } },
    } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
    expect(callCount).toBe(3);
  });

  it('does not retry a TruncatedAiResponseError -- the same content would truncate again deterministically', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount++;
          return jsonCompletion({ items: [] }, 'length');
        } },
      },
    } as any;
    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('被截断');
    expect(callCount).toBe(1);
  });

  it('does not retry an API error because SDK retries are disabled and each request costs money', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount++;
          throw Object.assign(new Error('rate limited'), { status: 429 });
        } },
      },
    } as any;

    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('rate limited');
    expect(callCount).toBe(1);
  });

  it('does not retry a model refusal', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount++;
          return jsonCompletion(null, 'content_filter');
        } },
      },
    } as any;

    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('拒绝');
    expect(callCount).toBe(1);
  });

  it('does not retry a response interrupted by insufficient system resources', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount++;
          return jsonCompletion(null, 'insufficient_system_resource');
        } },
      },
    } as any;

    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('服务繁忙');
    expect(callCount).toBe(1);
  });

  it.each([9, 'Part14'])('rejects an out-of-range Part value: %s', async (part) => {
    const client = fakeClient([{
      term: 'bad part', meaning: 'm', example: 'e', notes: null, part,
      dateAdded: '2026-06-27', scenarioMajor: '未分类', scenarioMinor: '未分类',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);

    await expect(parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS)).rejects.toThrow('AI 解析失败');
  });

  it('normalizes the explicitly allowed Part4 compatibility value', async () => {
    const client = fakeClient([{
      term: 'venue', meaning: '场馆', example: 'e', notes: null, part: 'Part4',
      dateAdded: '2026-06-27', scenarioMajor: '娱乐', scenarioMinor: '剧场',
      meaningWasAiGenerated: false, exampleWasAiGenerated: false,
    }]);

    const result = await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);
    expect(result[0].part).toBe(4);
  });

  it('uses DeepSeek JSON mode with bounded output and thinking disabled', async () => {
    let params: any;
    const client = {
      chat: {
        completions: { create: async (received: any) => {
          params = received;
          return jsonCompletion({ items: [] });
        } },
      },
    } as any;

    await parseImportDocument(client, 'raw text', '2026-06-26', SCENARIOS);

    expect(params.model).toBe('deepseek-v4-flash');
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(params.max_tokens).toBe(8192);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.messages[0].role).toBe('system');
    expect(params.messages[1]).toEqual({ role: 'user', content: 'raw text' });
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
      chat: {
        completions: { create: async (params: any) => {
          callCount++;
          // Echo back one item per numbered entry line actually present in this call's content.
          const lines = (params.messages[1].content as string).split('\n').filter((l: string) => /^\d+\./.test(l));
          return jsonCompletion({
            items: lines.map((l: string, i: number) => ({
                term: `t${callCount}-${i}`, meaning: 'm', example: 'e', notes: null, part: 1,
                dateAdded: '2026-06-28', scenarioMajor: '未分类', scenarioMinor: '未分类',
                meaningWasAiGenerated: false, exampleWasAiGenerated: false,
            })),
          });
        } },
      },
    } as any;
    const text = `Part1\n时间:2026.06.28\n${entries(45)}`;
    const result = await parseImportDocument(client, text, '2026-06-28', SCENARIOS);
    expect(callCount).toBe(3); // 45 entries / 20 per batch -> 3 calls
    expect(result).toHaveLength(45); // all batches' results merged
  });
});

describe('suggestForTerm', () => {
  it('does not automatically retry a single-term suggestion', async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: { create: async () => {
          callCount += 1;
          return jsonCompletion(null);
        } },
      },
    } as any;

    await expect(suggestForTerm(client, 'workshop', 2, SCENARIOS)).rejects.toThrow('AI 解析失败');
    expect(callCount).toBe(1);
  });

  it('wraps the term in a single-item note and returns the parsed suggestion', async () => {
    const client = {
      chat: {
        completions: { create: async (params: any) => {
          expect(params.messages[1].content).toContain('workshop');
          return jsonCompletion({ items: [{
              term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
              dateAdded: '2026-01-01', scenarioMajor: '一般商务', scenarioMinor: '会议',
              meaningWasAiGenerated: true, exampleWasAiGenerated: true,
            }] });
        } },
      },
    } as any;
    const result = await suggestForTerm(client, 'workshop', 2, SCENARIOS);
    expect(result).toEqual({ meaning: '研讨会', example: 'ex', scenarioMajor: '一般商务', scenarioMinor: '会议' });
  });
});
