import type { AgentMessage, PlanSummary } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { createResponse } from '../azure/openaiClient.js';
import { PlanSchema } from './schemas.js';
import type { CompactedContext } from './compact.js';
import { extractOutputText, extractReasoningSummary } from '../utils/openai.js';
import { getReasoningOptions } from '../config/reasoning.js';

function formatContext(compacted: CompactedContext, latestUser: AgentMessage | undefined) {
  const lines: string[] = [];
  for (const msg of compacted.latest) {
    lines.push(`${msg.role.toUpperCase()}: ${msg.content}`);
  }
  if (compacted.summary.length) {
    lines.push('\nSummary bullets:');
    lines.push(...compacted.summary.map((item, idx) => `- ${idx + 1}. ${item}`));
  }
  if (compacted.salience.length) {
    lines.push('\nSalient notes:');
    for (const note of compacted.salience) {
      lines.push(`- ${note.topic ? `${note.topic}: ` : ''}${note.fact}`);
    }
  }
  if (latestUser) {
    lines.push(`\nLatest user request: ${latestUser.content}`);
  }
  return lines.join('\n');
}

export async function getPlan(messages: AgentMessage[], context: CompactedContext): Promise<PlanSummary> {
  const latestUser = [...messages].reverse().find((m) => m.role === 'user');

  const payload = formatContext(context, latestUser);

  try {
    const response = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'You decide the retrieval strategy for a grounded QA assistant. Return ONLY JSON that matches the provided schema.'
        },
        {
          role: 'user',
          content: payload
        }
      ],
      textFormat: PlanSchema,
      parallel_tool_calls: false,
      temperature: 0.2,
      max_output_tokens: 4000, // GPT-5 uses ~2000 reasoning tokens before JSON payload
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      reasoning: getReasoningOptions('planner')
    });

    const plan = JSON.parse(extractOutputText(response) || '{}');
    const reasoningSummary = extractReasoningSummary(response);
    return {
      confidence: typeof plan.confidence === 'number' ? plan.confidence : 0.5,
      steps: Array.isArray(plan.steps) ? plan.steps : [{ action: 'vector_search' }],
      reasoningSummary: reasoningSummary?.join(' ')
    };
  } catch (error) {
    console.warn('Structured planner failed, falling back to heuristic.', error);
    return {
      confidence: 0.3,
      steps: [{ action: 'vector_search' }]
    };
  }
}
