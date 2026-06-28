import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseImportDocument, suggestForTerm, splitIntoBatches } from '../../src/lib/importParser';
import { SCENARIOS } from '../../src/lib/scenarios';

function entries(n: number, start = 1) {
  return Array.from({ length: n }, (_, i) => `${start + i}. term${start + i} 释义说明`).join('\n');
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
});

describe('splitIntoBatches', () => {
  it('keeps a single small segment as one chunk, context included', () => {
    const text = `Part3\n时间:2026.06.28\n${entries(5)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Part3');
    expect(chunks[0]).toContain('时间:2026.06.28');
    expect(chunks[0]).toContain('1. term1');
    expect(chunks[0]).toContain('5. term5');
  });

  it('splits one segment into multiple batches and repeats its context on every batch', () => {
    const text = `Part3\n时间:2026.06.28\n${entries(45)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(3); // 20 + 20 + 5
    for (const chunk of chunks) {
      expect(chunk).toContain('Part3');
      expect(chunk).toContain('时间:2026.06.28');
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
    const text = `Part1\n时间:2026.06.27\n${entries(3)}\nPart2\n时间:2026.06.28\n${entries(3, 1)}`;
    const chunks = splitIntoBatches(text, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('Part1');
    expect(chunks[0]).toContain('2026.06.27');
    expect(chunks[0]).not.toContain('Part2');
    expect(chunks[1]).toContain('Part2');
    expect(chunks[1]).toContain('2026.06.28');
    expect(chunks[1]).not.toContain('Part1');
  });

  it('ignores blank lines between entries instead of treating them as a new segment', () => {
    const text = `Part3\n时间:2026.06.28\n\n1. term1 释义\n\n2. term2 释义\n\n`;
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
