import { describe, expect, it } from 'vitest';
import { createDeepSeekClient, DEEPSEEK_BASE_URL } from '../../src/lib/deepseekClient';

describe('createDeepSeekClient', () => {
  it('uses the DeepSeek endpoint and disables SDK retries', () => {
    const client = createDeepSeekClient('test-key');

    expect(client.baseURL).toBe(DEEPSEEK_BASE_URL);
    expect(client.maxRetries).toBe(0);
  });

  it('requires DEEPSEEK_API_KEY instead of falling back to an OpenAI key', () => {
    expect(() => createDeepSeekClient('')).toThrow('DEEPSEEK_API_KEY');
  });
});
