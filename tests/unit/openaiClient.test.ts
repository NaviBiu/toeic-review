import { describe, expect, it } from 'vitest';
import { createOpenAIClient } from '../../src/lib/openaiClient';

describe('createOpenAIClient', () => {
  it('disables SDK retries so one application attempt means one HTTP request', () => {
    const client = createOpenAIClient('test-key');

    expect(client.maxRetries).toBe(0);
  });
});
