import OpenAI from 'openai';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export function createDeepSeekClient(apiKey = process.env.DEEPSEEK_API_KEY): OpenAI {
  if (!apiKey?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  return new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: DEEPSEEK_BASE_URL,
    maxRetries: 0,
  });
}
