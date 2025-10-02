import type {
  AgentMessage,
  PlanSummary,
  Reference,
  ActivityStep,
  WebResult,
  WebSearchResponse
} from '../../../shared/types.js';
import { agenticRetrieveTool, webSearchTool } from '../tools/index.js';
import type { SalienceNote } from './compact.js';
import { config } from '../config/app.js';
import { estimateTokens } from './contextBudget.js';

export interface DispatchResult {
  contextText: string;
  references: Reference[];
  activity: ActivityStep[];
  webResults: WebResult[];
  webContextText: string;
  webContextTokens: number;
  webContextTrimmed: boolean;
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
    webSearch?: (args: { query: string; count?: number; mode?: 'summary' | 'full' }) => Promise<WebSearchResponse>;
  };
}

function buildWebContext(results: WebResult[], maxTokens: number) {
  if (!results.length || maxTokens <= 0) {
    return {
      text: '',
      tokens: 0,
      trimmed: false,
      usedResults: [] as WebResult[]
    };
  }

  const sorted = [...results].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const used: WebResult[] = [];
  const blocks: string[] = [];
  let tokens = 0;
  let trimmed = false;

  for (const [index, result] of sorted.entries()) {
    const header = `[Web ${index + 1}] ${result.title}`;
    const bodyLines = [result.snippet];
    if (result.body && result.body !== result.snippet) {
      bodyLines.push(result.body);
    }
    bodyLines.push(result.url);
    const block = `${header}\n${bodyLines.filter(Boolean).join('\n')}`;
    const blockTokens = estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, block);
    if (tokens + blockTokens > maxTokens && used.length) {
      trimmed = true;
      break;
    }
    if (tokens + blockTokens > maxTokens && !used.length) {
      // even single block exceeds cap; include it but note trim
      trimmed = true;
    }
    blocks.push(block);
    tokens += blockTokens;
    used.push(result);
    if (tokens >= maxTokens) {
      trimmed = true;
      break;
    }
  }

  return {
    text: blocks.join('\n\n'),
    tokens,
    trimmed,
    usedResults: used
  };
}

function latestUserQuery(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return last?.content ?? '';
}

export async function dispatchTools({ plan, messages, salience, emit, tools }: DispatchOptions): Promise<DispatchResult> {
  const references: Reference[] = [];
  const activity: ActivityStep[] = [];
  const webResults: WebResult[] = [];
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
  let webContextText = '';
  let webContextTokens = 0;
  let webContextTrimmed = false;
  if (wantsWeb) {
    emit?.('status', { stage: 'web_search' });
    const step = plan.steps.find((s) => s.action === 'web_search' || s.action === 'both');
    const query = step?.query?.trim() || queryFallback;
    const count = step?.k ?? 5;
    try {
      const search = await webSearch({ query, count, mode: config.WEB_SEARCH_MODE });
      if (search.results?.length) {
        webResults.push(...search.results);
        activity.push({
          type: 'web_search',
          description: `Fetched ${search.results.length} web results for "${query}".`
        });

        if (search.contextText) {
          webContextText = search.contextText;
          webContextTokens = search.tokens ?? estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, search.contextText);
          webContextTrimmed = Boolean(search.trimmed);
          emit?.('web_context', {
            tokens: webContextTokens,
            trimmed: webContextTrimmed,
            results: search.results.map((result) => ({
              id: result.id,
              title: result.title,
              url: result.url,
              rank: result.rank
            })),
            text: search.contextText
          });
          if (webContextTrimmed) {
            activity.push({
              type: 'web_context_trim',
              description: `Web context truncated by search tool (${search.results.length} results, ${webContextTokens} tokens).`
            });
          }
        } else {
          const { text, tokens, trimmed, usedResults } = buildWebContext(search.results, config.WEB_CONTEXT_MAX_TOKENS);
          webContextText = text;
          webContextTokens = tokens;
          webContextTrimmed = trimmed;

          if (trimmed) {
            activity.push({
              type: 'web_context_trim',
              description: `Web context truncated to ${usedResults.length} results (${tokens} tokens).`
            });
          }

          emit?.('web_context', {
            tokens,
            trimmed,
            results: usedResults.map((result) => ({
              id: result.id,
              title: result.title,
              url: result.url,
              rank: result.rank
            })),
            text
          });
        }
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
    webContextText,
    webContextTokens,
    webContextTrimmed,
    source
  };
}
