// LLMProvider — the seam between the HLYST engine and whatever generates DJ
// dialogue text. Every call site (engine-tick, generate-break) should import
// `llmProvider` from here, never call a model API directly. Swapping the
// active provider later — including to Vercel AI Gateway, which needs no
// separate account (see header note below) — is a one-line change at the
// bottom of this file, matching the pattern already established in
// broadcastProvider.ts for Live365.

export interface LLMResult {
  text: string;
  provider: string;
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(systemPrompt: string, userPrompt: string): Promise<LLMResult>;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    if (!text) throw new Error('Anthropic returned no text content.');
    return { text, provider: this.name };
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI returned no text content.');
    return { text, provider: this.name };
  }
}

export class GatewayProvider implements LLMProvider {
  readonly name = 'gateway';
  private readonly model: string;

  constructor(model = 'anthropic/claude-sonnet-4-6') {
    this.model = model;
  }

  isConfigured(): boolean {
    return Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY);
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
    const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI Gateway error (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('AI Gateway returned no text content.');
    return { text, provider: this.name };
  }
}

const candidates: LLMProvider[] = [new AnthropicProvider(), new OpenAIProvider(), new GatewayProvider()];

export function getLLMProvider(): LLMProvider | null {
  return candidates.find((p) => p.isConfigured()) ?? null;
}

export function isAnyLLMConfigured(): boolean {
  return candidates.some((p) => p.isConfigured());
}
