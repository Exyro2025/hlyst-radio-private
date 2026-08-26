// Thin compatibility wrapper — delegates to providers/LLMProvider.ts, which
// is where the real provider logic and portability boundary now lives.
// Kept so engine-tick/route.ts and generate-break/route.ts don't need any
// changes: same function signature as before this refactor.

import { getLLMProvider } from './providers/LLMProvider';

export async function callLLM(systemPrompt: string, userPrompt: string): Promise<{ text: string; provider: 'anthropic' | 'openai' | string }> {
  const provider = getLLMProvider();
  if (!provider) {
    throw new Error('No LLM configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, or deploy on Vercel for automatic AI Gateway access.');
  }
  const result = await provider.generate(systemPrompt, userPrompt);
  return { text: result.text, provider: result.provider };
}
