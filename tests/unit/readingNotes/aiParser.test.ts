import { describe, expect, it, vi } from 'vitest';
import { parseReadingImportWithAi } from '@/lib/readingNotes/aiParser';

describe('reading import AI fallback', () => {
  it('uses one non-streaming capped DeepSeek-compatible completion', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [{
              category: '固定搭配',
              contentHtml: '<p class="MsoNormal">as a result</p>',
              notes: null,
              date: '2026-09-03',
            }],
          }),
        },
      }],
    });
    const client = { chat: { completions: { create } } };

    const result = await parseReadingImportWithAi(
      client as never,
      '分类：固定搭配\n知识点：as a result',
      '2026-09-03',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      categoryName: '固定搭配',
      contentText: 'as a result',
      noteDate: '2026-09-03',
      confidence: 'high',
    });
    expect(result[0].contentHtml).not.toContain('class=');
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      stream: false,
      thinking: { type: 'disabled' },
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });
  });
});
