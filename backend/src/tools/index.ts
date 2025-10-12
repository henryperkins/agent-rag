import { withRetry } from '../utils/resilience.js';
import { hybridSemanticSearch, vectorSearch, isRestrictiveFilter } from '../azure/directSearch.js';
import { federatedSearch } from '../azure/multiIndexSearch.js';
import { lazyHybridSearch } from '../azure/lazyRetrieval.js';
import { retrieveWithAdaptiveRefinement } from '../azure/adaptiveRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import type { AgentMessage, Reference, LazyReference, FeatureOverrideMap } from '../../../shared/types.js';
import { extractOutputText } from '../utils/openai.js';

export const toolSchemas = {
  retrieve: {
    type: 'function' as const,
    name: 'retrieve',
    description:
      'Search the knowledge base using hybrid semantic search (vector + keyword + semantic ranking).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        filter: {
          type: 'string',
          description: "Optional OData filter (e.g., \"metadata/category eq 'nasa'\")"
        },
        top: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 5
        }
      },
      required: ['query']
    }
  },
  web_search: {
    type: 'function' as const,
    name: 'web_search',
    description: 'Search the web using Google for up-to-date information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number', default: 5 }
      },
      required: ['query']
    }
  },
  answer: {
    type: 'function' as const,
    name: 'answer',
    description: 'Generate a final answer from retrieved context with citations.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        context: { type: 'string' },
        citations: { type: 'array', items: { type: 'object' } }
      },
      required: ['question', 'context']
    }
  }
};

/**
 * Direct Azure AI Search retrieval tool
 * Uses hybrid semantic search with full control over query parameters
 */
export async function retrieveTool(args: {
  query: string;
  filter?: string;
  top?: number;
  messages?: AgentMessage[];
  features?: FeatureOverrideMap;
}) {
  const { query, filter, top, features } = args;
  const enableFederation = (features?.ENABLE_MULTI_INDEX_FEDERATION ?? config.ENABLE_MULTI_INDEX_FEDERATION) === true;

  try {
    return await withRetry('direct-search', async () => {
      if (enableFederation) {
        try {
          const federated = await federatedSearch(query, {
            top: top || config.RAG_TOP_K,
            filter
          });

          if (federated.references.length) {
            const description = Object.entries(federated.indexBreakdown)
              .map(([name, count]) => `${name}:${count}`)
              .join(', ');

            return {
              response: '',
              references: federated.references,
              activity: [
                {
                  type: 'federated_search',
                  description: `Federated search returned ${federated.references.length} results (${description})`
                }
              ]
            };
          }
        } catch (federationError) {
          console.warn('Federated search failed, falling back to single-index retrieval:', federationError);
        }
      }

      // Check if adaptive retrieval is enabled
      const enableAdaptive = (features?.ENABLE_ADAPTIVE_RETRIEVAL ?? config.ENABLE_ADAPTIVE_RETRIEVAL) === true;

      if (enableAdaptive) {
        // Use adaptive retrieval with quality assessment and query reformulation
        const adaptiveResult = await retrieveWithAdaptiveRefinement(
          query,
          {
            top: top || config.RAG_TOP_K,
            filter,
            minCoverage: config.ADAPTIVE_MIN_COVERAGE,
            minDiversity: config.ADAPTIVE_MIN_DIVERSITY
          },
          1, // attempt (starts at 1)
          config.ADAPTIVE_MAX_ATTEMPTS
        );
        const attempts = adaptiveResult.attempts ?? [];
        const initial = adaptiveResult.initialQuality ?? adaptiveResult.quality;
        const finalQ = adaptiveResult.quality;
        const triggered = (attempts?.length ?? 1) > 1 || adaptiveResult.reformulations.length > 0;
        const trigger_reason = initial.coverage < (config.ADAPTIVE_MIN_COVERAGE ?? 0.4)
          && initial.diversity < (config.ADAPTIVE_MIN_DIVERSITY ?? 0.3)
          ? 'both'
          : initial.coverage < (config.ADAPTIVE_MIN_COVERAGE ?? 0.4)
          ? 'coverage'
          : initial.diversity < (config.ADAPTIVE_MIN_DIVERSITY ?? 0.3)
          ? 'diversity'
          : null;
        const latency_ms_total = attempts.reduce((sum, a) => sum + (a.latency_ms ?? 0), 0);
        const redact = (s: string) => (s.length <= 60 ? s : `${s.slice(0, 30)} … ${s.slice(-20)}`);
        const adaptiveStats = {
          enabled: true,
          attempts: attempts.length || (triggered ? adaptiveResult.reformulations.length + 1 : 1),
          triggered,
          trigger_reason,
          thresholds: { coverage: config.ADAPTIVE_MIN_COVERAGE, diversity: config.ADAPTIVE_MIN_DIVERSITY },
          initial_quality: initial,
          final_quality: finalQ,
          reformulations_count: adaptiveResult.reformulations.length,
          reformulations_sample: adaptiveResult.reformulations.slice(0, 2).map(redact),
          latency_ms_total,
          per_attempt: attempts.map((a) => ({
            attempt: a.attempt,
            query: redact(a.query),
            quality: a.quality,
            latency_ms: a.latency_ms
          }))
        } as const;

        return {
          response: '',
          references: adaptiveResult.references,
          adaptiveStats: adaptiveStats as any,
          activity: [
            {
              type: 'adaptive_search',
              description: `Retrieved ${adaptiveResult.references.length} results (coverage: ${adaptiveResult.quality.coverage.toFixed(2)}, diversity: ${adaptiveResult.quality.diversity.toFixed(2)})${adaptiveResult.reformulations.length ? `, ${adaptiveResult.reformulations.length} reformulations` : ''}`
            },
            ...(adaptiveResult.reformulations.length
              ? [
                  {
                    type: 'query_reformulation',
                    description: `Reformulated: ${adaptiveResult.reformulations.join(' → ')}`
                  }
                ]
              : [])
          ]
        };
      }

      try {
        // Primary: Hybrid semantic search with high threshold
        const result = await hybridSemanticSearch(query, {
          top: top || config.RAG_TOP_K,
          filter,
          rerankerThreshold: config.RERANKER_THRESHOLD,
          searchFields: ['page_chunk'],
          selectFields: ['id', 'page_chunk', 'page_number']
        });

        // If we have good results, return them
        const activity: any[] = [];
        // Vector filter mode note (heuristic)
        if (filter && isRestrictiveFilter(filter)) {
          activity.push({
            type: 'vector_filter_mode',
            description: 'Using preFilter for vector search due to restrictive filter.'
          });
        }
        // Coverage gate note
        // Note: Azure returns @search.coverage as 0-100 percentage; normalize to 0-1 for comparison
        if (typeof result.coverage === 'number' && (result.coverage / 100) < config.SEARCH_MIN_COVERAGE) {
          activity.push({
            type: 'low_coverage',
            description: `Search coverage ${result.coverage.toFixed(0)}% below ${(config.SEARCH_MIN_COVERAGE * 100).toFixed(0)}% threshold.`
          });
        }

        if (result.references.length >= config.RETRIEVAL_MIN_DOCS) {
          return {
            response: '', // Not needed for orchestrator pattern
            references: result.references,
            activity: [
              {
                type: 'search',
                description: `Hybrid semantic search returned ${result.references.length} results (threshold: ${config.RERANKER_THRESHOLD})`
              },
              ...activity
            ]
          };
        }

        // Fallback: Lower threshold
        console.log(`Insufficient results (${result.references.length}), retrying with lower threshold`);
        const fallbackResult = await hybridSemanticSearch(query, {
          top: top || config.RAG_TOP_K,
          filter,
          rerankerThreshold: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
          searchFields: ['page_chunk'],
          selectFields: ['id', 'page_chunk', 'page_number']
        });

        return {
          response: '',
          references: fallbackResult.references,
          activity: [
            {
              type: 'search',
              description: `Hybrid semantic search (fallback) returned ${fallbackResult.references.length} results (threshold: ${config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD})`
            }
          ]
        };
      } catch (semanticError) {
        // Final fallback: Pure vector search (no semantic ranking dependency)
        console.warn('Hybrid semantic search failed, falling back to pure vector search:', semanticError);
        const vectorResult = await vectorSearch(query, {
          top: top || config.RAG_TOP_K,
          filter
        });

        return {
          response: '',
          references: vectorResult.references,
          activity: [
            {
              type: 'fallback_search',
              description: `Vector-only search returned ${vectorResult.references.length} results`
            }
          ]
        };
      }
    });
  } catch (error) {
    console.error('All retrieval methods failed:', error);
    throw new Error(`Retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function lazyRetrieveTool(args: { query: string; filter?: string; top?: number }) {
  const { query, filter, top } = args;

  try {
    const result = await lazyHybridSearch({
      query,
      filter,
      top: top || config.RAG_TOP_K,
      prefetchCount: config.LAZY_PREFETCH_COUNT
    });

    const references: LazyReference[] = result.references;

    return {
      response: '',
      references: references.map((ref) => ({
        id: ref.id,
        title: ref.title,
        content: ref.content,
        page_number: ref.page_number,
        url: ref.url,
        score: ref.score
      })),
      activity: [
        {
          type: 'lazy_search',
          description: `Lazy search returned ${references.length} summaries (${result.summaryTokens} tokens)`
        }
      ],
      lazyReferences: references,
      summaryTokens: result.summaryTokens,
      mode: 'lazy' as const,
      fullContentAvailable: result.fullContentAvailable
    };
  } catch (error) {
    console.error('Lazy retrieval failed, falling back to direct search:', error);
    return retrieveTool({ query, filter, top });
  }
}

export { webSearchTool };

export async function answerTool(args: {
  question: string;
  context: string;
  citations?: Reference[];
  revisionNotes?: string[];
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
  previousResponseId?: string;
  features?: FeatureOverrideMap;
}) {
  const { features, previousResponseId, ...rest } = args;
  const enableResponseStorage = (features?.ENABLE_RESPONSE_STORAGE ?? config.ENABLE_RESPONSE_STORAGE) === true;

  let userPrompt = `Question: ${args.question}\n\nContext:\n${args.context}`;
  if (args.revisionNotes && args.revisionNotes.length > 0) {
    userPrompt += `\n\nRevision guidance (address these issues):\n${args.revisionNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}`;
  }

  const systemPrompt =
    rest.systemPrompt ??
    'You are a helpful assistant. Respond using only the provided context. Cite sources inline as [1], [2], etc. Say "I do not know" when the answer is not grounded.';

  const response = await createResponse({
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    temperature: rest.temperature ?? 0.3,
    max_output_tokens: rest.maxTokens ?? 600,
    model: rest.model,
    textFormat: { type: 'text' },
    parallel_tool_calls: config.RESPONSES_PARALLEL_TOOL_CALLS,
    truncation: 'auto',
    store: enableResponseStorage,
    // Only send previous_response_id when storage is enabled
    ...(enableResponseStorage && previousResponseId ? { previous_response_id: previousResponseId } : {})
  });

  let answer = extractOutputText(response);
  if (!answer) {
    answer = 'I do not know.';
  }

  const responseId = (response as { id?: string } | undefined)?.id;

  return { answer, citations: args.citations ?? [], responseId };
}
