import type { Env } from '../../types.js';

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

export async function moderateText(env: Env, text: string): Promise<ModerationResult> {
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`OpenAI moderation ${res.status}`);
  const data = await res.json() as { results: ModerationResult[] };
  return data.results[0];
}
