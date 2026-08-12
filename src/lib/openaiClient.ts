import OpenAI from 'openai';

export function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 0 });
}
