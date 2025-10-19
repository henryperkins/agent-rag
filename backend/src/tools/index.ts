import { withRetry } from '../utils/resilience.js';
import { hybridSemanticSearch, vectorSearch, isRestrictiveFilter } from '../azure/directSearch.js';
import { federatedSearch } from '../azure/multiIndexSearch.js';
import { lazyHybridSearch } from '../azure/lazyRetrieval.js';
import { retrieveWithAdaptiveRefinement } from '../azure/adaptiveRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import type {
  ActivityStep,
  AdaptiveRetrievalStats,
  AgentMessage,
  Reference,
  LazyReference,
  FeatureOverrideMap
} from '../../../shared/types.js';
import { extractOutputText } from '../utils/openai.js';
import { sanitizeUserField } from '../utils/session.js';

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
  const enableFederation =
    (features?.ENABLE_MULTI_INDEX_FEDERATION ?? config.ENABLE_MULTI_INDEX_FEDERATION) === true;

  const minDocs = config.RETRIEVAL_MIN_DOCS;
  let fallbackAttempts = 0;
  let fallbackTriggered = false;

  const baseTop = top || config.RAG_TOP_K;
  const searchFields = ['page_chunk'];
  const selectFields = ['id', 'page_chunk', 'page_number'];

  const withTimestamp = (step: ActivityStep): ActivityStep => ({
    ...step,
    timestamp: new Date().toISOString()
  });

  const finalize = (
    references: Reference[],
    activity: ActivityStep[],
    extras: Partial<AgenticRetrievalResponse> = {}
  ): AgenticRetrievalResponse => ({
    response: '',
    references,
    activity,
    fallbackAttempts,
    minDocumentsRequired: minDocs,
    fallbackTriggered,
    ...extras
  });

  const runFallbackPipeline = async (
    existingActivity: ActivityStep[]
  ): Promise<{ references: Reference[]; activity: ActivityStep[] }> => {
    fallbackTriggered = true;
    const activity = [...existingActivity];

    // Stage 1: lower reranker threshold
    fallbackAttempts += 1;
    const fallbackResult = await hybridSemanticSearch(query, {
      top: baseTop,
      filter,
      rerankerThreshold: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
      searchFields,
      selectFields
    });
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `Hybrid semantic fallback returned ${fallbackResult.references.length} result(s) (threshold: ${config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD}).`
      })
    );
    if (fallbackResult.references.length >= minDocs) {
      return { references: fallbackResult.references.slice(0, baseTop), activity };
    }

    // Stage 2: relax threshold and expand top-k
    fallbackAttempts += 1;
    const expandedTop = Math.max(baseTop * 2, baseTop);
    const relaxedResult = await hybridSemanticSearch(query, {
      top: expandedTop,
      filter,
      rerankerThreshold: 0,
      searchFields,
      selectFields
    });
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `Hybrid semantic fallback (threshold 0, top=${expandedTop}) returned ${relaxedResult.references.length} result(s).`
      })
    );
    if (relaxedResult.references.length >= minDocs) {
      return { references: relaxedResult.references.slice(0, baseTop), activity };
    }

    // Stage 3: pure vector fallback
    fallbackAttempts += 1;
    const vectorResult = await vectorSearch(query, {
      top: baseTop,
      filter
    });
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `Vector-only fallback returned ${vectorResult.references.length} result(s).`
      })
    );
    return { references: vectorResult.references, activity };
  };

  try {
    return await withRetry('direct-search', async () => {
      if (enableFederation) {
        try {
          const federated = await federatedSearch(query, {
            top: baseTop,
            filter
          });

          if (federated.references.length) {
            const federatedActivity: ActivityStep[] = [
              withTimestamp({
                type: 'federated_search',
                description: `Federated search returned ${federated.references.length} result(s).`
              })
            ];
            return finalize(federated.references, federatedActivity);
          }
        } catch (federationError) {
          console.warn('Federated search failed, falling back to single-index retrieval:', federationError);
        }
      }

      const enableAdaptive =
        (features?.ENABLE_ADAPTIVE_RETRIEVAL ?? config.ENABLE_ADAPTIVE_RETRIEVAL) === true;

      if (enableAdaptive) {
        const adaptiveResult = await retrieveWithAdaptiveRefinement(
          query,
          {
            top: baseTop,
            filter,
            minCoverage: config.ADAPTIVE_MIN_COVERAGE,
            minDiversity: config.ADAPTIVE_MIN_DIVERSITY
          },
          1,
          config.ADAPTIVE_MAX_ATTEMPTS
        );

        const attempts = adaptiveResult.attempts ?? [];
        const initial = adaptiveResult.initialQuality ?? adaptiveResult.quality;
        const finalQuality = adaptiveResult.quality;
        const triggered =
          (attempts?.length ?? 1) > 1 || adaptiveResult.reformulations.length > 0;

        const redact = (s: string) => (s.length <= 60 ? s : `${s.slice(0, 30)} … ${s.slice(-20)}`);

        const adaptiveStats: AdaptiveRetrievalStats = {
          enabled: true,
          attempts: attempts.length || (triggered ? adaptiveResult.reformulations.length + 1 : 1),
          triggered,
          trigger_reason:
            initial.coverage < (config.ADAPTIVE_MIN_COVERAGE ?? 0.4) &&
            initial.diversity < (config.ADAPTIVE_MIN_DIVERSITY ?? 0.3)
              ? 'both'
              : initial.coverage < (config.ADAPTIVE_MIN_COVERAGE ?? 0.4)
              ? 'coverage'
              : initial.diversity < (config.ADAPTIVE_MIN_DIVERSITY ?? 0.3)
              ? 'diversity'
              : null,
          thresholds: {
            coverage: config.ADAPTIVE_MIN_COVERAGE,
            diversity: config.ADAPTIVE_MIN_DIVERSITY
          },
          initial_quality: initial,
          final_quality: finalQuality,
          reformulations_count: adaptiveResult.reformulations.length,
          reformulations_sample: adaptiveResult.reformulations.slice(0, 2).map(redact),
          latency_ms_total: attempts.reduce((sum, a) => sum + (a.latency_ms ?? 0), 0),
          per_attempt: attempts.map((a) => ({
            attempt: a.attempt,
            query: redact(a.query),
            quality: a.quality,
            latency_ms: a.latency_ms
          }))
        };

        const adaptiveActivity: ActivityStep[] = [
          withTimestamp({
            type: 'adaptive_search',
            description: `Adaptive retrieval returned ${adaptiveResult.references.length} result(s) (coverage=${adaptiveResult.quality.coverage.toFixed(
              2
            )}, diversity=${adaptiveResult.quality.diversity.toFixed(2)}).`
          })
        ];

        if (adaptiveResult.reformulations.length) {
          adaptiveActivity.push(
            withTimestamp({
              type: 'query_reformulation',
              description: `Reformulations: ${adaptiveResult.reformulations.join(' → ')}`
            })
          );
        }

        if (adaptiveResult.references.length >= minDocs) {
          return finalize(adaptiveResult.references, adaptiveActivity, {
            adaptiveStats
          });
        }

        const fallbackOutcome = await runFallbackPipeline(adaptiveActivity);
        return finalize(fallbackOutcome.references, fallbackOutcome.activity, {
          adaptiveStats
        });
      }

      const activity: ActivityStep[] = [];
      if (filter && isRestrictiveFilter(filter)) {
        activity.push(
          withTimestamp({
            type: 'vector_filter_mode',
            description: 'Using preFilter for vector search due to restrictive filter.'
          })
        );
      }

      const result = await hybridSemanticSearch(query, {
        top: baseTop,
        filter,
        rerankerThreshold: config.RERANKER_THRESHOLD,
        searchFields,
        selectFields
      });

      if (
        typeof result.coverage === 'number' &&
        result.coverage / 100 < config.SEARCH_MIN_COVERAGE
      ) {
        activity.push(
          withTimestamp({
            type: 'low_coverage',
            description: `Search coverage ${result.coverage.toFixed(
              0
            )}% below ${(config.SEARCH_MIN_COVERAGE * 100).toFixed(0)}% threshold.`
          })
        );
      }

      const primaryActivity: ActivityStep[] = [
        withTimestamp({
          type: 'search',
          description: `Hybrid semantic search returned ${result.references.length} result(s) (threshold: ${config.RERANKER_THRESHOLD}).`
        }),
        ...activity
      ];

      if (result.references.length >= minDocs) {
        return finalize(result.references, primaryActivity);
      }

      console.log(
        `Insufficient results (${result.references.length}); attempting fallback retrieval pipeline.`
      );
      const fallbackOutcome = await runFallbackPipeline(primaryActivity);
      return finalize(fallbackOutcome.references, fallbackOutcome.activity);
    });
  } catch (error) {
    fallbackTriggered = true;
    fallbackAttempts += 1;
    console.warn('Hybrid semantic search failed, falling back to pure vector search:', error);
    const vectorResult = await vectorSearch(query, {
      top: baseTop,
      filter
    });
    const fallbackActivity: ActivityStep[] = [
      withTimestamp({
        type: 'fallback_search',
        description: `Vector-only fallback returned ${vectorResult.references.length} result(s).`
      })
    ];
    return finalize(vectorResult.references, fallbackActivity);
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
  sessionId?: string;
  userId?: string;
  intent?: string;
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
    max_output_tokens: rest.maxTokens ?? 3000, // Increased from 600 for richer answers (GPT-5: 128K output)
    model: rest.model,
    textFormat: { type: 'text' },
    parallel_tool_calls: config.RESPONSES_PARALLEL_TOOL_CALLS,
    truncation: 'auto',
    store: enableResponseStorage,
    metadata: {
      sessionId: args.sessionId ?? '',
      userId: args.userId ?? args.sessionId ?? '',
      intent: args.intent ?? ''
    },
    user: sanitizeUserField(args.userId ?? args.sessionId ?? 'unknown'),
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
