// Shared by generate-break/route.ts (manual preview) and engine-tick/route.ts
// (the real decide-then-generate pipeline) — extracted here once a second
// caller needed the same Anthropic/OpenAI logic, rather than copying it
// again.

export async function callLLM(systemPrompt: string, userPrompt: string): Promise<{ text: string; provider: 'anthropic' | 'openai' }> {
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if (!hasAnthropic && !hasOpenAI) {
    throw new Error('No LLM configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  if (hasAnthropic) {
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
    return { text, provider: 'anthropic' };
  }

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
  return { text, provider: 'openai' };
}
