import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';
import type { AgentMessage } from '../../../shared/types.js';

const SYSTEM_PROMPT = `You are a routing agent that chooses the best action for a user query.
Actions:
- retrieve: consult the knowledge base (preferred for factual questions)
- answer: respond directly without retrieval (greetings, acknowledgements)
- web_search: use Bing for current events or when knowledge base is insufficient

Consider recent conversation context and output JSON:
{"action":"retrieve|answer|web_search","reasoning":"...","confidence":0.0-1.0}`;

export interface AdvancedPlanResult {
  action: 'retrieve' | 'answer' | 'web_search';
  reasoning: string;
  confidence: number;
}

export async function decideAdvancedPlan(messages: AgentMessage[]): Promise<AdvancedPlanResult> {
  if (messages.length === 0) {
    return { action: 'answer', reasoning: 'Empty conversation.', confidence: 1 };
  }

  const credential = new DefaultAzureCredential();
  const client = new AzureOpenAI({
    endpoint: config.AZURE_OPENAI_ENDPOINT,
    apiVersion: config.AZURE_OPENAI_API_VERSION,
    azureADTokenProvider: async () => {
      const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
      return tokenResponse?.token ?? '';
    }
  });

  const history = messages
    .slice(-5)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const completion = await client.chat.completions.create({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.3,
      max_tokens: 150,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: history }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as AdvancedPlanResult;

    return {
      action: parsed.action ?? 'retrieve',
      reasoning: parsed.reasoning ?? 'Default to retrieval.',
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5))
    };
  } catch (error) {
    console.error('Advanced planner error:', error);
    const last = messages[messages.length - 1];
    const needsRetrieval =
      last.content.includes('?') ||
      /^(what|how|why|when|where|who)/i.test(last.content);
    return {
      action: needsRetrieval ? 'retrieve' : 'answer',
      reasoning: 'Fallback heuristic used due to planner failure.',
      confidence: 0.5
    };
  }
}
