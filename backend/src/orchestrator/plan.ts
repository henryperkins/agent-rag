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
    const rawSteps = Array.isArray(plan.steps) ? [...plan.steps] : [];
    const sanitizedSteps = rawSteps
      .filter((step) => step && typeof step === 'object')
      .map((step) => {
        const action = typeof step.action === 'string' ? step.action : 'vector_search';
        const query =
          typeof step.query === 'string' && step.query.trim().length > 0
            ? step.query.trim()
            : latestUser?.content ?? '';
        const limitedQuery = query.length > 512 ? query.slice(0, 512) : query;
        const defaultK =
          action === 'web_search' || action === 'both' ? config.WEB_RESULTS_MAX : config.RAG_TOP_K;
        const k =
          typeof step.k === 'number' && Number.isFinite(step.k) && step.k > 0
            ? Math.floor(step.k)
            : defaultK;
        return { ...step, action, query: limitedQuery, k };
      });

    const hasVectorStep = sanitizedSteps.some(
      (step) => step.action === 'vector_search' || step.action === 'both'
    );

    if (!hasVectorStep) {
      sanitizedSteps.unshift({
        action: 'vector_search',
        query: (latestUser?.content ?? '').slice(0, 512),
        k: config.RAG_TOP_K
      });
    }

    return {
      confidence: typeof plan.confidence === 'number' ? plan.confidence : 0.5,
      steps: sanitizedSteps.length ? sanitizedSteps : [{ action: 'vector_search', query: latestUser?.content ?? '', k: config.RAG_TOP_K }],
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
