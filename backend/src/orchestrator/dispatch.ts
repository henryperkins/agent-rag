import type { AgentMessage, PlanSummary, Reference, ActivityStep } from '../../../shared/types.js';
import { agenticRetrieveTool, webSearchTool } from '../tools/index.js';
import type { SalienceNote } from './compact.js';
import { config } from '../config/app.js';

export interface DispatchResult {
  contextText: string;
  references: Reference[];
  activity: ActivityStep[];
  webResults: Array<{ title: string; snippet: string; url: string }>;
  source: 'knowledge_agent' | 'fallback_vector';
}

interface DispatchOptions {
  plan: PlanSummary;
  messages: AgentMessage[];
  salience: SalienceNote[];
  emit?: (event: string, data: unknown) => void;
  tools?: {
    retrieve?: (args: { messages: AgentMessage[] }) => Promise<{
      response: string;
      references: Reference[];
      activity: ActivityStep[];
    }>;
    webSearch?: (args: { query: string; count?: number }) => Promise<{ results: Array<{ title: string; snippet: string; url: string }> }>;
  };
}

function latestUserQuery(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return last?.content ?? '';
}

export async function dispatchTools({ plan, messages, salience, emit, tools }: DispatchOptions): Promise<DispatchResult> {
  const references: Reference[] = [];
  const activity: ActivityStep[] = [];
  const webResults: Array<{ title: string; snippet: string; url: string }> = [];
  const retrievalSnippets: string[] = [];
  let source: 'knowledge_agent' | 'fallback_vector' = 'knowledge_agent';

  const queryFallback = latestUserQuery(messages);
  const retrieve = tools?.retrieve ?? agenticRetrieveTool;
  const webSearch = tools?.webSearch ?? webSearchTool;

  const shouldRetrieve = plan.steps.some((step) => step.action === 'vector_search' || step.action === 'both');
  if (shouldRetrieve) {
    emit?.('status', { stage: 'retrieval' });
    const retrieval = await retrieve({ messages });
    references.push(...(retrieval.references ?? []));
    activity.push(
      ...(retrieval.activity ?? []),
      {
        type: 'plan',
        description: 'Knowledge agent retrieval executed via orchestrator.'
      }
    );
    if (typeof retrieval.response === 'string' && retrieval.response.trim().length) {
      retrievalSnippets.push(retrieval.response.trim());
    }
    if (retrieval.activity?.some((step) => step.type === 'fallback_search')) {
      source = 'fallback_vector';
    }
  }

  const wantsWeb = plan.steps.some((step) => step.action === 'web_search' || step.action === 'both');
  if (wantsWeb) {
    emit?.('status', { stage: 'web_search' });
    const step = plan.steps.find((s) => s.action === 'web_search' || s.action === 'both');
    const query = step?.query?.trim() || queryFallback;
    const count = step?.k ?? 5;
    try {
      const search = await webSearch({ query, count });
      if (search.results?.length) {
        webResults.push(...search.results);
        activity.push({
          type: 'web_search',
          description: `Fetched ${search.results.length} web results for "${query}".`
        });
      }
    } catch (error) {
      activity.push({
        type: 'web_search_error',
        description: `Web search failed: ${(error as Error).message}`
      });
    }
  }

  const salienceText = salience.map((note, idx) => `[Salience ${idx + 1}] ${note.fact}`).join('\n');
  const referenceText = references
    .map((ref, idx) => `[${idx + 1}] ${ref.content ?? ''}`)
    .join('\n\n');

  const contextText = [referenceText, retrievalSnippets.join('\n\n'), salienceText]
    .filter(Boolean)
    .join('\n\n');

  if (references.length < config.RETRIEVAL_MIN_DOCS) {
    activity.push({
      type: 'retrieval_underflow',
      description: `Retrieved ${references.length} documents (<${config.RETRIEVAL_MIN_DOCS}). Consider fallback expansion.`
    });
  }

  return {
    contextText,
    references,
    activity,
    webResults,
    source
  };
}
