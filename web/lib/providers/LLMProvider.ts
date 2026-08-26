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

// ── GatewayProvider ──────────────────────────────────────────────────────
// Vercel AI Gateway, via the official `ai` SDK's createGateway() — not a
// hand-rolled fetch call. This matters: Vercel's own SDK is what correctly
// resolves the OIDC credential at runtime (its exact delivery mechanism —
// env var vs. request header vs. internal caching — is Vercel's to handle
// and isn't reliably reproducible with a manual fetch). Confirmed present
// in the same controller/src/llm/internal/provider/registry.ts pattern
// this codebase already uses for the 'gateway' case. On a Vercel
// deployment this needs no API key at all once OIDC federation is
// enabled in Project Settings -> Security.
//
// Off Vercel (see DEPLOYMENT.md), set AI_GATEWAY_API_KEY instead, since
// OIDC is a Vercel-runtime-only mechanism.

export class GatewayProvider implements LLMProvider {
  readonly name = 'gateway';
  private readonly model: string;

  constructor(model = 'anthropic/claude-sonnet-4-6') {
    this.model = model;
  }

  isConfigured(): boolean {
    // On Vercel with OIDC federation enabled, the SDK resolves credentials
    // itself with no env var required — so this can't check for a token's
    // presence the way the other providers check for an API key. Instead,
    // this provider is offered as a last-resort candidate (see
    // getLLMProvider() below) and its actual availability is proven by
    // whether generate() succeeds, not guessed at here.
    return true;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
    const { gateway } = await import('ai');
    const { generateText } = await import('ai');
    const result = await generateText({
      model: gateway(this.model),
      system: systemPrompt,
      prompt: userPrompt,
    });
    if (!result.text) throw new Error('AI Gateway returned no text content.');
    return { text: result.text, provider: this.name };
  }
}

// ── Provider selection ───────────────────────────────────────────────────
// Tries each configured provider in order; the first one that's actually
// configured is used. Order: explicit Anthropic key, explicit OpenAI key,
// then Gateway last — since GatewayProvider.isConfigured() can't verify
// OIDC availability in advance, it's the last resort so an explicit key
// always wins when present, and Gateway is only reached (and its actual
// success/failure known) when no explicit key exists.

const candidates: LLMProvider[] = [new AnthropicProvider(), new OpenAIProvider(), new GatewayProvider()];

export function getLLMProvider(): LLMProvider | null {
  return candidates.find((p) => p.isConfigured()) ?? null;
}

export function isAnyLLMConfigured(): boolean {
  return candidates.some((p) => p.isConfigured());
}
