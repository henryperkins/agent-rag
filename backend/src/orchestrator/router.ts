import type { AgentMessage } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { createResponse } from '../azure/openaiClient.js';
import { extractOutputText } from '../utils/openai.js';

export interface RouteConfig {
  intent: string;
  model: string;
  retrieverStrategy: 'hybrid' | 'vector' | 'web' | 'hybrid+web';
  maxTokens: number;
  systemPromptHints?: string;
}

export const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  faq: {
    intent: 'faq',
    model: config.MODEL_FAQ,
    retrieverStrategy: 'vector',
    maxTokens: config.MAX_TOKENS_FAQ,
    systemPromptHints: 'Provide a concise, direct answer grounded in the supplied evidence.'
  },
  research: {
    intent: 'research',
    model: config.MODEL_RESEARCH,
    retrieverStrategy: 'hybrid+web',
    maxTokens: config.MAX_TOKENS_RESEARCH,
    systemPromptHints: 'Synthesize multiple sources, cite inline, and explain trade-offs or rationale when helpful.'
  },
  factual_lookup: {
    intent: 'factual_lookup',
    model: config.MODEL_FACTUAL,
    retrieverStrategy: 'hybrid',
    maxTokens: config.MAX_TOKENS_FACTUAL,
    systemPromptHints: 'Return the precise fact requested with direct citations. Avoid speculation.'
  },
  conversational: {
    intent: 'conversational',
    model: config.MODEL_CONVERSATIONAL,
    retrieverStrategy: 'vector',
    maxTokens: config.MAX_TOKENS_CONVERSATIONAL,
    systemPromptHints: 'Respond conversationally while staying grounded in prior context. Keep answers brief.'
  }
};

const INTENT_CLASSIFICATION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'intent_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: {
        enum: Object.keys(ROUTE_CONFIGS)
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1
      },
      reasoning: {
        type: 'string'
      }
    },
    required: ['intent', 'confidence'],
    description: 'Structured JSON describing the classified user intent and rationale.'
  }
};

export async function classifyIntent(question: string, history?: AgentMessage[]): Promise<{
  intent: string;
  confidence: number;
  reasoning: string;
}> {
  if (!config.ENABLE_INTENT_ROUTING) {
    return {
      intent: 'research',
      confidence: 1,
      reasoning: 'Intent routing disabled'
    };
  }

  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return {
      intent: 'conversational',
      confidence: 0.2,
      reasoning: 'Empty question defaults to conversational'
    };
  }

  const historySnippet = history && history.length
    ? history
        .slice(-4)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join('\n')
    : '';

  const systemPrompt = `You are an intent classifier for an Azure OpenAI powered RAG assistant. Classify the user's latest question into one of the intents below:
- faq: straightforward questions answerable with a single fact ("What is X?", "How do I do Y?")
- factual_lookup: specific data lookups ("When was X released?", "What is the endpoint for Y?")
- research: open-ended or multi-part questions requiring synthesis from several sources.
- conversational: greetings, acknowledgements, or chit-chat that do not require retrieval.
Return strict JSON matching the provided schema.`;

  try {
    const response = await createResponse({
      model: config.INTENT_CLASSIFIER_MODEL,
      temperature: 0.1,
      max_output_tokens: config.INTENT_CLASSIFIER_MAX_TOKENS,
      textFormat: INTENT_CLASSIFICATION_SCHEMA,
      parallel_tool_calls: false,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Question: ${trimmedQuestion}${historySnippet ? `\n\nRecent conversation:\n${historySnippet}` : ''}`
        }
      ]
    });

    const parsed = JSON.parse(extractOutputText(response) || '{}');
    const intent = typeof parsed.intent === 'string' && ROUTE_CONFIGS[parsed.intent]
      ? parsed.intent
      : 'research';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided';

    return { intent, confidence, reasoning };
  } catch (error) {
    console.warn('Intent classification failed, defaulting to research intent', error);
    return {
      intent: 'research',
      confidence: 0.5,
      reasoning: 'Classification error fallback'
    };
  }
}

export function getRouteConfig(intent: string): RouteConfig {
  return ROUTE_CONFIGS[intent] ?? ROUTE_CONFIGS.research;
}
