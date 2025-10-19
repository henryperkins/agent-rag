import { createResponse } from '../azure/openaiClient.js';

const CRITIC_PROMPT = `You are a quality critic. Score the draft answer (0-1) on groundedness to context.
If score < 0.8, suggest revisions. Output JSON: {"score": number, "reasoning": string, "action": "accept"|"revise", "suggestions": string[] }`;

export interface Critique {
  score: number;
  reasoning: string;
  action: 'accept' | 'revise';
  suggestions?: string[];
}

export async function critiqueDraft(draft: string, context: string, question: string): Promise<Critique> {
  const response = await createResponse({
    messages: [
      { role: 'system', content: 'You are an impartial quality reviewer.' },
      {
        role: 'user',
        content: `${CRITIC_PROMPT}\n\nQuestion: ${question}\nContext: ${context}\nDraft: ${draft}`
      }
    ],
    temperature: 0.0,
    max_output_tokens: 1500, // Increased from 300 for thorough critique reasoning (GPT-5: 128K output)
    textFormat: {
      type: 'json_schema',
      name: 'legacy_critic',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'number' },
          reasoning: { type: 'string' },
          action: { enum: ['accept', 'revise'] },
          suggestions: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['score', 'reasoning', 'action']
      }
    },
    parallel_tool_calls: false
  });

  const raw = response.output_text ?? '{}';
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Critique;
    return {
      score: Math.max(0, Math.min(1, parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? 'No reasoning provided.',
      action: parsed.action === 'accept' ? 'accept' : 'revise',
      suggestions: parsed.suggestions
    };
  } catch {
    return {
      score: 0.8,
      reasoning: 'Critic parsing failed; accepting draft.',
      action: 'accept'
    };
  }
}
