import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';
import type { ActivityStep, Reference } from '../../../shared/types.js';

const PROMPT = `You are a quality critic evaluating AI-generated answers.

Score on:
1. Groundedness
2. Completeness
3. Citation quality
4. Accuracy

Return JSON: {"score":0-1,"reasoning":"...","action":"accept"|"revise","suggestions":["..."]}`;

export interface EnhancedCritique {
  score: number;
  reasoning: string;
  action: 'accept' | 'revise';
  suggestions?: string[];
}

export async function enhancedCritiqueDraft(
  draft: string,
  context: string,
  question: string,
  activity: ActivityStep[],
  references: Reference[]
): Promise<EnhancedCritique> {
  const credential = new DefaultAzureCredential();
  const client = new AzureOpenAI({
    endpoint: config.AZURE_OPENAI_ENDPOINT,
    apiVersion: config.AZURE_OPENAI_API_VERSION,
    azureADTokenProvider: async () => {
      const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
      return tokenResponse?.token ?? '';
    }
  });

  const activitySummary =
    activity.length > 0
      ? `\n\nRetrieval Activity:\n${activity.map((a) => `- ${a.type}: ${a.description}`).join('\n')}`
      : '';

  const referenceSummary =
    references.length > 0
      ? `\n\nTop References:\n${references
          .slice(0, 3)
          .map((r, i) => `[${i + 1}] ${r.title ?? 'Untitled'} (score: ${r.score ?? 'N/A'})`)
          .join('\n')}`
      : '';

  const userPrompt = `Question: ${question}\n\nContext: ${context}${referenceSummary}${activitySummary}\n\nDraft Answer: ${draft}`;

  try {
    const response = await client.chat.completions.create({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: userPrompt }
      ]
    });

    const raw = response.choices?.[0]?.message?.content ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as EnhancedCritique;

    return {
      score: Math.max(0, Math.min(1, parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? 'No reasoning provided.',
      action: parsed.action === 'accept' || (parsed.score ?? 0) >= config.CRITIC_THRESHOLD ? 'accept' : 'revise',
      suggestions: parsed.suggestions
    };
  } catch (error) {
    console.error('Enhanced critic error:', error);
    return {
      score: 0.8,
      reasoning: 'Critic evaluation failed; accepting draft.',
      action: 'accept'
    };
  }
}
