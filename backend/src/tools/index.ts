import { randomUUID } from 'node:crypto';
import { withRetry } from '../utils/resilience.js';
import { hybridSemanticSearch, vectorSearch, isRestrictiveFilter } from '../azure/directSearch.js';
import { federatedSearch } from '../azure/multiIndexSearch.js';
import { lazyHybridSearch } from '../azure/lazyRetrieval.js';
import { invokeKnowledgeAgent } from '../azure/knowledgeAgent.js';
import { retrieveWithAdaptiveRefinement } from '../azure/adaptiveRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import { getReasoningOptions } from '../config/reasoning.js';
import type {
  ActivityStep,
  AdaptiveRetrievalStats,
  Reference,
  LazyReference,
  FeatureOverrideMap,
  AgenticRetrievalResponse,
  AgentMessage,
  KnowledgeAgentGroundingSummary
} from '../../../shared/types.js';
import { extractOutputText, extractReasoningSummary, sanitizeLogMessage } from '../utils/openai.js';
import { sanitizeUserField } from '../utils/session.js';
import { enforceRerankerThreshold } from '../utils/reranker-threshold.js';
import { validateCitationIntegrity } from '../utils/citation-validator.js';

function buildKnowledgeAgentMessages(
  messages: AgentMessage[] | undefined,
  query: string
): Array<{ role: string; content: Array<{ type: 'text'; text: string }> }> {
  const history: Array<{ role: string; content: Array<{ type: 'text'; text: string }> }> = Array.isArray(messages)
    ? messages
        .map((message) => ({
          role: message.role,
          content: [{ type: 'text' as const, text: (message.content ?? '').toString() }]
        }))
        .filter((entry) => entry.content[0].text && entry.content[0].text.trim().length > 0)
    : [];

  const trimmedQuery = query.trim();
  if (
    trimmedQuery.length > 0 &&
    (history.length === 0 ||
      history[history.length - 1].role !== 'user' ||
      history[history.length - 1].content[0].text.trim() !== trimmedQuery)
  ) {
    history.push({ role: 'user', content: [{ type: 'text' as const, text: trimmedQuery }] });
  }

  // Keep only the most recent 30 turns to avoid oversized payloads
  const MAX_MESSAGES = 30;
  if (history.length > MAX_MESSAGES) {
    return history.slice(history.length - MAX_MESSAGES);
  }
  return history;
}

function mergeKnowledgeAgentReferences(
  knowledgeRefs: Reference[],
  directRefs: Reference[],
  limit: number
): Reference[] {
  if (!knowledgeRefs.length) {
    return directRefs.slice(0, limit);
  }

  const combined: Reference[] = [];
  const seen = new Set<string>();

  const push = (ref: Reference) => {
    const key =
      ref.id ??
      `${ref.url ?? ''}|${ref.page_number ?? ''}|${(ref.content ?? '').slice(0, 64)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    combined.push(ref);
  };

  knowledgeRefs.forEach(push);
  directRefs.forEach(push);

  return combined.slice(0, limit);
}

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
 * Retrieval tool that supports Azure Knowledge Agent and direct index search.
 *
 * When `config.RETRIEVAL_STRATEGY` is set to `knowledge_agent` or `hybrid`
 * and conversational messages are provided, the tool will attempt to invoke
 * the Azure Knowledge Agent endpoint with full chat history before falling
 * back to direct index search (hybrid semantic + vector).
 */
export async function retrieveTool(args: {
  query: string;
  filter?: string;
  top?: number;
  messages?: AgentMessage[];
  features?: FeatureOverrideMap;
}) {
  const { query, filter, top, messages, features } = args;
  const enableFederation =
    (features?.ENABLE_MULTI_INDEX_FEDERATION ?? config.ENABLE_MULTI_INDEX_FEDERATION) === true;

  const minDocs = config.RETRIEVAL_MIN_DOCS;
  let fallbackAttempts = 0;
  let fallbackTriggered = false;
  const correlationId = randomUUID();
  let knowledgeAgentFailurePhase: 'invocation' | 'zero_results' | 'partial_results' | undefined;
  let knowledgeAgentStatusCode: number | undefined;
  let knowledgeAgentErrorMessage: string | undefined;
  let knowledgeAgentRequestId: string | undefined;
  let knowledgeAgentCorrelationId = correlationId;
  let knowledgeAgentAttempted = false;
  let knowledgeAgentGrounding: KnowledgeAgentGroundingSummary | undefined;
  let knowledgeAgentAnswer: string | undefined;
  let thresholdUsed = config.RERANKER_THRESHOLD;
  const thresholdHistory: number[] = [];
  const recordThreshold = (value: number) => {
    thresholdHistory.push(value);
    thresholdUsed = value;
  };

  const baseTop = top || config.RAG_TOP_K;
  const searchFields = ['page_chunk'];
  const selectFields = ['id', 'page_chunk', 'page_number'];
  const retrievalStrategy = config.RETRIEVAL_STRATEGY;
  const knowledgeAgentPreferred =
    (retrievalStrategy === 'knowledge_agent' || retrievalStrategy === 'hybrid') &&
    Array.isArray(messages) &&
    messages.length > 0;

  const withTimestamp = (step: ActivityStep): ActivityStep => ({
    ...step,
    timestamp: new Date().toISOString()
  });

  const buildDiagnostics = (): AgenticRetrievalResponse['diagnostics'] => {
    const diagnostics: AgenticRetrievalResponse['diagnostics'] = {
      correlationId,
      fallbackAttempts,
      knowledgeAgentSummaryProvided: Boolean(knowledgeAgentAnswer && knowledgeAgentAnswer.trim().length > 0)
    };
    if (knowledgeAgentAttempted) {
      diagnostics.knowledgeAgent = {
        correlationId: knowledgeAgentCorrelationId,
        attempted: true,
        fallbackTriggered,
        requestId: knowledgeAgentRequestId,
        statusCode: knowledgeAgentStatusCode,
        errorMessage: knowledgeAgentErrorMessage,
        failurePhase: knowledgeAgentFailurePhase
      };
      if (knowledgeAgentGrounding) {
        diagnostics.knowledgeAgent.grounding = knowledgeAgentGrounding;
      }
    }
    return diagnostics;
  };

  const finalize = (
    references: Reference[],
    activity: ActivityStep[],
    extras: Partial<AgenticRetrievalResponse> = {}
  ): AgenticRetrievalResponse => {
    const response: AgenticRetrievalResponse = {
      response: '',
      references,
      activity,
      fallbackAttempts,
      minDocumentsRequired: minDocs,
      fallbackTriggered,
      diagnostics: extras.diagnostics ?? buildDiagnostics(),
      ...extras
    };

    if (knowledgeAgentGrounding && response.knowledgeAgentGrounding === undefined) {
      response.knowledgeAgentGrounding = knowledgeAgentGrounding;
    }
    if (response.thresholdUsed === undefined) {
      response.thresholdUsed = thresholdUsed;
    }
    if (!response.thresholdHistory) {
      response.thresholdHistory = thresholdHistory.slice();
    }
    if (response.coverageChecklistCount === undefined && typeof extras.coverageChecklistCount === 'number') {
      response.coverageChecklistCount = extras.coverageChecklistCount;
    }
    if (!response.contextSectionLabels && Array.isArray(extras.contextSectionLabels)) {
      response.contextSectionLabels = extras.contextSectionLabels;
    }
    if (response.knowledgeAgentSummaryProvided === undefined) {
      const candidateSummary = response.knowledgeAgentAnswer ?? knowledgeAgentAnswer;
      response.knowledgeAgentSummaryProvided = Boolean(
        typeof candidateSummary === 'string' && candidateSummary.trim().length > 0
      );
    }

    return response;
  };

  const runFallbackPipeline = async (
    existingActivity: ActivityStep[]
  ): Promise<{ references: Reference[]; activity: ActivityStep[]; threshold: number }> => {
    fallbackTriggered = true;
    const activity = [...existingActivity];
    const fallbackThreshold = config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD;
    const thresholdFloor = Math.max(
      Math.min(config.RETRIEVAL_MIN_RERANKER_THRESHOLD, fallbackThreshold),
      0
    );

    // Stage 1: lower reranker threshold
    fallbackAttempts += 1;
    const fallbackResult = await hybridSemanticSearch(query, {
      top: baseTop,
      filter,
      rerankerThreshold: fallbackThreshold,
      searchFields,
      selectFields,
      correlationId
    });
    recordThreshold(fallbackThreshold);
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `[correlation=${correlationId}] Hybrid semantic fallback returned ${fallbackResult.references.length} result(s) (threshold: ${fallbackThreshold}).`
      })
    );
    if (fallbackResult.references.length >= minDocs) {
      return {
        references: fallbackResult.references.slice(0, baseTop),
        activity,
        threshold: fallbackThreshold
      };
    }

    // Stage 2: relax threshold and expand top-k
    fallbackAttempts += 1;
    const expandedTop = Math.max(baseTop * 2, baseTop);
    const relaxedResult = await hybridSemanticSearch(query, {
      top: expandedTop,
      filter,
      rerankerThreshold: thresholdFloor,
      searchFields,
      selectFields,
      correlationId
    });
    recordThreshold(thresholdFloor);
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `[correlation=${correlationId}] Hybrid semantic fallback (threshold ${thresholdFloor}, top=${expandedTop}) returned ${relaxedResult.references.length} result(s).`
      })
    );
    if (relaxedResult.references.length >= minDocs) {
      return {
        references: relaxedResult.references.slice(0, baseTop),
        activity,
        threshold: thresholdFloor
      };
    }

    // Stage 3: pure vector fallback
    fallbackAttempts += 1;
    const vectorResult = await vectorSearch(query, {
      top: baseTop,
      filter
    });
    recordThreshold(thresholdFloor);
    activity.push(
      withTimestamp({
        type: 'fallback_search',
        description: `[correlation=${correlationId}] Vector-only fallback returned ${vectorResult.references.length} result(s) (quality floor: ${thresholdFloor}).`
      })
    );
    return { references: vectorResult.references, activity, threshold: thresholdFloor };
  };

  try {
    return await withRetry('direct-search', async (_signal) => {
      knowledgeAgentGrounding = undefined;
      knowledgeAgentAnswer = undefined;
      let knowledgeAgentReferences: Reference[] = [];
      const knowledgeAgentActivity: ActivityStep[] = [];

      if (knowledgeAgentPreferred) {
        const agentMessages = buildKnowledgeAgentMessages(messages, query);
        if (agentMessages.length) {
          knowledgeAgentAttempted = true;
          try {
            const agentResult = await invokeKnowledgeAgent({
              messages: agentMessages,
              filter,
              correlationId
            });

            knowledgeAgentGrounding = agentResult.grounding;
            knowledgeAgentCorrelationId = (agentResult.correlationId ?? correlationId) as string;
            knowledgeAgentRequestId = agentResult.requestId;

            if (Array.isArray(agentResult.activity) && agentResult.activity.length) {
              knowledgeAgentActivity.push(...agentResult.activity);
            }

            if (knowledgeAgentGrounding) {
              const mappedCount = Object.keys(knowledgeAgentGrounding.mapping ?? {}).length;
              const unmatchedCount = knowledgeAgentGrounding.unmatched.length;
              knowledgeAgentActivity.push(
                withTimestamp({
                  type: 'knowledge_agent_grounding',
                  description: `Unified grounding mapped ${mappedCount} id(s); unmatched ${unmatchedCount}.`
                })
              );
            }

            knowledgeAgentReferences = (agentResult.references ?? []).slice(
              0,
              Math.max(baseTop * 2, baseTop)
            );
            knowledgeAgentAnswer = agentResult.answer;
            knowledgeAgentFailurePhase = undefined;
            knowledgeAgentStatusCode = undefined;
            knowledgeAgentErrorMessage = undefined;

            if (knowledgeAgentReferences.some((ref) => typeof ref.score === 'number')) {
              const enforcement = enforceRerankerThreshold(
                knowledgeAgentReferences,
                config.RERANKER_THRESHOLD,
                {
                  correlationId: knowledgeAgentCorrelationId,
                  source: 'knowledge_agent'
                }
              );
              knowledgeAgentReferences = enforcement.references;
            }
            recordThreshold(config.RERANKER_THRESHOLD);

            const summaryDescription = `Knowledge agent returned ${knowledgeAgentReferences.length} result(s). [correlation=${knowledgeAgentCorrelationId}]`;
            knowledgeAgentActivity.push(
              withTimestamp({
                type: 'knowledge_agent_search',
                description: summaryDescription
              })
            );

            if (knowledgeAgentReferences.length >= minDocs) {
              console.info(
                JSON.stringify({
                  event: 'knowledge_agent.success',
                  correlationId: knowledgeAgentCorrelationId,
                  requestId: knowledgeAgentRequestId,
                  documents: knowledgeAgentReferences.length,
                  minDocs
                })
              );
              const successExtras: Partial<AgenticRetrievalResponse> = {
                response: knowledgeAgentAnswer ?? '',
                mode: 'knowledge_agent',
                strategy: retrievalStrategy,
                knowledgeAgentAnswer
              };
              if (knowledgeAgentGrounding) {
                successExtras.knowledgeAgentGrounding = knowledgeAgentGrounding;
              }
              return finalize(knowledgeAgentReferences.slice(0, baseTop), knowledgeAgentActivity, successExtras);
            }

            fallbackTriggered = true;
            if (!knowledgeAgentReferences.length) {
              knowledgeAgentFailurePhase = 'zero_results';
              const description = `Knowledge agent returned 0 result(s); falling back to direct search. [correlation=${knowledgeAgentCorrelationId}]`;
              knowledgeAgentActivity.push(
                withTimestamp({
                  type: 'knowledge_agent_fallback',
                  description
                })
              );
              console.warn(
                JSON.stringify({
                  event: 'knowledge_agent.fallback',
                  correlationId: knowledgeAgentCorrelationId,
                  requestId: knowledgeAgentRequestId,
                  reason: 'zero_results',
                  minDocs,
                  returned: 0
                })
              );
            } else {
              knowledgeAgentFailurePhase = 'partial_results';
              const description = `Knowledge agent returned ${knowledgeAgentReferences.length} result(s); supplementing with direct search. [correlation=${knowledgeAgentCorrelationId}]`;
              knowledgeAgentActivity.push(
                withTimestamp({
                  type: 'knowledge_agent_partial',
                  description
                })
              );
              console.warn(
                JSON.stringify({
                  event: 'knowledge_agent.fallback',
                  correlationId: knowledgeAgentCorrelationId,
                  requestId: knowledgeAgentRequestId,
                  reason: 'insufficient_results',
                  minDocs,
                  returned: knowledgeAgentReferences.length
                })
              );
            }
          } catch (agentError) {
            fallbackTriggered = true;
            knowledgeAgentFailurePhase = 'invocation';
            const errorCorrelation = (agentError as { correlationId?: string }).correlationId;
            if (errorCorrelation) {
              knowledgeAgentCorrelationId = errorCorrelation as string;
            }
            knowledgeAgentStatusCode =
              typeof (agentError as { status?: number }).status === 'number'
                ? (agentError as { status: number }).status
                : typeof (agentError as { statusCode?: number }).statusCode === 'number'
                ? (agentError as { statusCode: number }).statusCode
                : undefined;
            knowledgeAgentErrorMessage =
              agentError instanceof Error ? agentError.message : String(agentError);
            knowledgeAgentRequestId =
              (agentError as { requestId?: string }).requestId ?? knowledgeAgentRequestId;
            const sanitizedError = sanitizeLogMessage(knowledgeAgentErrorMessage ?? 'Unknown error');
            const errorDescription = `Knowledge agent failed [correlation=${knowledgeAgentCorrelationId}${
              knowledgeAgentStatusCode ? ` status=${knowledgeAgentStatusCode}` : ''
            }]: ${sanitizedError}`;

            knowledgeAgentActivity.push(
              withTimestamp({
                type: 'knowledge_agent_error',
                description: errorDescription
              })
            );

            console.error(
              JSON.stringify({
                event: 'knowledge_agent.failure',
                correlationId: knowledgeAgentCorrelationId,
                requestId: knowledgeAgentRequestId,
                statusCode: knowledgeAgentStatusCode,
                message: sanitizedError,
                fallbackTriggered: true,
                messagesLength: agentMessages.length
              })
            );
          }
        }
      }

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
        console.warn(
          JSON.stringify({
            event: 'federated_search.failure',
            correlationId,
            message: federationError instanceof Error ? federationError.message : String(federationError),
            stack: federationError instanceof Error ? federationError.stack : undefined
          })
        );
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

        if (knowledgeAgentReferences.length) {
          adaptiveResult.references = mergeKnowledgeAgentReferences(
            knowledgeAgentReferences,
            adaptiveResult.references ?? [],
            baseTop
          );
        }

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
          ...knowledgeAgentActivity,
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
          const extras: Partial<AgenticRetrievalResponse> = { adaptiveStats };
          if (knowledgeAgentGrounding) {
            extras.knowledgeAgentGrounding = knowledgeAgentGrounding;
          }
          if (knowledgeAgentAttempted) {
            extras.strategy = retrievalStrategy;
            if (knowledgeAgentAnswer) {
              extras.knowledgeAgentAnswer = knowledgeAgentAnswer;
            }
          }
          return finalize(adaptiveResult.references.slice(0, baseTop), adaptiveActivity, extras);
        }

        const fallbackOutcome = await runFallbackPipeline(adaptiveActivity);
        const mergedFallback = knowledgeAgentReferences.length
          ? mergeKnowledgeAgentReferences(
              knowledgeAgentReferences,
              fallbackOutcome.references,
              baseTop
            )
          : fallbackOutcome.references.slice(0, baseTop);
        const fallbackExtras: Partial<AgenticRetrievalResponse> = { adaptiveStats };
        if (knowledgeAgentGrounding) {
          fallbackExtras.knowledgeAgentGrounding = knowledgeAgentGrounding;
        }
        if (knowledgeAgentAttempted) {
          fallbackExtras.strategy = retrievalStrategy;
          if (knowledgeAgentAnswer) {
            fallbackExtras.knowledgeAgentAnswer = knowledgeAgentAnswer;
          }
        }
        thresholdUsed = fallbackOutcome.threshold;
        return finalize(mergedFallback, fallbackOutcome.activity, fallbackExtras);
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
      selectFields,
      correlationId
    });
    recordThreshold(config.RERANKER_THRESHOLD);

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
        ...knowledgeAgentActivity,
        withTimestamp({
          type: 'search',
          description: `[correlation=${correlationId}] Hybrid semantic search returned ${result.references.length} result(s) (threshold: ${config.RERANKER_THRESHOLD}).`
        }),
        ...activity
      ];

      if (knowledgeAgentReferences.length) {
        result.references = mergeKnowledgeAgentReferences(
          knowledgeAgentReferences,
          result.references,
          baseTop
        );
      }

      if (result.references.length >= minDocs) {
        const extras: Partial<AgenticRetrievalResponse> = {};
        if (knowledgeAgentGrounding) {
          extras.knowledgeAgentGrounding = knowledgeAgentGrounding;
        }
        if (knowledgeAgentAttempted) {
          extras.strategy = retrievalStrategy;
          if (knowledgeAgentAnswer) {
            extras.knowledgeAgentAnswer = knowledgeAgentAnswer;
          }
        }
        return finalize(result.references, primaryActivity, extras);
      }

      console.log(
        `Insufficient results (${result.references.length}); attempting fallback retrieval pipeline.`
      );
      const fallbackOutcome = await runFallbackPipeline(primaryActivity);
      const mergedFallback = knowledgeAgentReferences.length
        ? mergeKnowledgeAgentReferences(
            knowledgeAgentReferences,
            fallbackOutcome.references,
            baseTop
          )
        : fallbackOutcome.references.slice(0, baseTop);
      const extras: Partial<AgenticRetrievalResponse> = {};
      if (knowledgeAgentGrounding) {
        extras.knowledgeAgentGrounding = knowledgeAgentGrounding;
      }
      if (knowledgeAgentAttempted) {
        extras.strategy = retrievalStrategy;
        if (knowledgeAgentAnswer) {
          extras.knowledgeAgentAnswer = knowledgeAgentAnswer;
        }
      }
      thresholdUsed = fallbackOutcome.threshold;
      return finalize(mergedFallback, fallbackOutcome.activity, extras);
    });
  } catch (error) {
    fallbackTriggered = true;
    fallbackAttempts += 1;
    console.error(
      JSON.stringify({
        event: 'hybrid_search.failure',
        correlationId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    );
    const vectorResult = await vectorSearch(query, {
      top: baseTop,
      filter
    });
    const thresholdFloor = Math.max(
      Math.min(config.RETRIEVAL_MIN_RERANKER_THRESHOLD, config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD),
      0
    );
    const fallbackActivity: ActivityStep[] = [
      withTimestamp({
        type: 'fallback_search',
        description: `[correlation=${correlationId}] Vector-only fallback returned ${vectorResult.references.length} result(s) (quality floor: ${thresholdFloor}).`
      })
    ];
    recordThreshold(thresholdFloor);
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
    reasoning: getReasoningOptions('synthesis'),
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
  const reasoningSummary = extractReasoningSummary(response);
  if (config.NODE_ENV === 'development') {
    console.debug('[DEBUG] Extracted reasoning summary:', {
      found: !!reasoningSummary,
      count: reasoningSummary?.length ?? 0,
      summaries: reasoningSummary,
      responseId,
      responseKeys: response ? Object.keys(response) : []
    });
  }
  const hasCitations = Array.isArray(args.citations) && args.citations.length > 0;
  if (hasCitations) {
    if (!/\[\d+\]/.test(answer)) {
      answer = 'I do not know. (No grounded citations available)';
    } else if (!validateCitationIntegrity(answer, args.citations ?? [])) {
      answer = 'I do not know. (Citation validation failed)';
    }
  }

  const usage = (response as { usage?: unknown } | undefined)?.usage;

  return { answer, citations: args.citations ?? [], responseId, reasoningSummary: reasoningSummary?.join(' '), usage };
}
