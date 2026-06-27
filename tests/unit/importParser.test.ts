import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, parseImportDocument, suggestForTerm } from '../../src/lib/importParser';
import { SCENARIOS } from '../../src/lib/scenarios';

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
