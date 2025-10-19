import type { AgentMessage } from '../../../shared/types.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import { getReasoningOptions } from '../config/reasoning.js';
import { extractOutputText, extractReasoningSummary } from '../utils/openai.js';

interface SummaryResult {
  bullets: string[];
}

interface SalienceResult {
  notes: Array<{ fact: string; topic?: string }>;
}

export interface SalienceNote {
  fact: string;
  topic?: string;
  lastSeenTurn: number;
}

export interface CompactedContext {
  latest: AgentMessage[];
  summary: string[];
  salience: SalienceNote[];
  insights?: string[];
}

const SUMMARY_SCHEMA = {
  type: 'json_schema' as const,
  name: 'conversation_summary',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      bullets: {
        type: 'array',
        items: { type: 'string' },
        maxItems: config.CONTEXT_MAX_SUMMARY_ITEMS
      }
    },
    required: ['bullets']
  }
};

const SALIENCE_SCHEMA = {
  type: 'json_schema' as const,
  name: 'salience_notes',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fact: { type: 'string' },
            topic: { type: 'string' }
          },
          required: ['fact']
        },
        maxItems: config.CONTEXT_MAX_SALIENCE_ITEMS
      }
    },
    required: ['notes']
  }
};

export async function compactHistory(messages: AgentMessage[]): Promise<CompactedContext> {
  const recent = messages.slice(-config.CONTEXT_MAX_RECENT_TURNS);
  const older = messages.slice(0, -recent.length);

  if (older.length === 0) {
    return {
      latest: recent,
      summary: [],
      salience: []
    };
  }

  const transcript = older
    .map((m, idx) => `${idx + 1}. ${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  let summary: string[] = [];
  let salience: SalienceNote[] = [];
  const insights: string[] = [];

  try {
    const summaryResp = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'Summarize the conversation history into concise bullet points capturing decisions, unresolved questions, and facts.'
        },
        { role: 'user', content: transcript }
      ],
      textFormat: SUMMARY_SCHEMA,
      parallel_tool_calls: false,
      temperature: 0.2,
      max_output_tokens: 3000, // GPT-5 uses ~600-1000 reasoning tokens before JSON payload
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      reasoning: getReasoningOptions('compaction')
    });

    const parsed: SummaryResult = JSON.parse(extractOutputText(summaryResp) || '{}');
    summary = parsed?.bullets?.filter(Boolean) ?? [];
    const reasoningSummary = extractReasoningSummary(summaryResp);
    if (reasoningSummary) {
      insights.push(...reasoningSummary);
    }
  } catch (error) {
    summary = [];
    console.warn('Summary generation failed:', error);
  }

  try {
    const salienceResp = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'Identify user preferences, key facts, or TODO items worth remembering for future turns.'
        },
        { role: 'user', content: transcript }
      ],
      textFormat: SALIENCE_SCHEMA,
      parallel_tool_calls: false,
      temperature: 0.2,
      max_output_tokens: 2500, // GPT-5 uses ~500-800 reasoning tokens before JSON payload
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      reasoning: getReasoningOptions('compaction')
    });

    const parsed: SalienceResult = JSON.parse(extractOutputText(salienceResp) || '{}');
    salience = (parsed?.notes ?? []).map((note) => ({
      fact: note.fact,
      topic: note.topic,
      lastSeenTurn: older.length
    }));
    const reasoningSummary = extractReasoningSummary(salienceResp);
    if (reasoningSummary) {
      insights.push(...reasoningSummary);
    }
  } catch (error) {
    salience = [];
    console.warn('Salience extraction failed:', error);
  }

  return {
    latest: recent,
    summary,
    salience,
    insights: insights.length ? insights : undefined
  };
}
