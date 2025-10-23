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

/**
 * Helper to add timestamp to activity steps
 */
const withTimestamp = (step: ActivityStep): ActivityStep => ({
  ...step,
  timestamp: new Date().toISOString()
});

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

/**
 * Handles Knowledge Agent retrieval including invocation, result processing,
 * and fallback logic. Extracted to reduce complexity and improve testability.
 */
async function handleKnowledgeAgentRetrieval(params: {
  messages: AgentMessage[];
  query: string;
  filter?: string;
  correlationId: string;
  signal: AbortSignal;
  retryAttempt: number;
  baseTop: number;
  minDocs: number;
  recordThreshold: (threshold: number) => void;
}): Promise<{
  references: Reference[];
  activity: ActivityStep[];
  answer?: string;
  grounding?: KnowledgeAgentGroundingSummary;
  correlationId: string;
  requestId?: string;
  statusCode?: number;
  errorMessage?: string;
  failurePhase?: 'invocation' | 'zero_results' | 'partial_results';
  fallbackTriggered: boolean;
}> {
  const {
    messages,
    query,
    filter,
    correlationId,
    signal,
    retryAttempt,
    baseTop,
    minDocs,
    recordThreshold
  } = params;

  const activity: ActivityStep[] = [];
  let references: Reference[] = [];
  let answer: string | undefined;
  let grounding: KnowledgeAgentGroundingSummary | undefined;
  let agentCorrelationId = correlationId;
  let requestId: string | undefined;
  let statusCode: number | undefined;
  let errorMessage: string | undefined;
  let failurePhase: 'invocation' | 'zero_results' | 'partial_results' | undefined;
  let fallbackTriggered = false;

  const agentMessages = buildKnowledgeAgentMessages(messages, query);
  if (!agentMessages.length) {
    return {
      references: [],
      activity,
      correlationId: agentCorrelationId,
      fallbackTriggered: false
    };
  }

  try {
    const agentResult = await invokeKnowledgeAgent({
      messages: agentMessages,
      filter,
      correlationId,
      signal,
      retryAttempt
    });

    grounding = agentResult.grounding;
    agentCorrelationId = agentResult.correlationId ?? correlationId;
    requestId = agentResult.requestId;

    if (Array.isArray(agentResult.activity) && agentResult.activity.length) {
      activity.push(...agentResult.activity);
    }

    if (grounding) {
      const mappedCount = Object.keys(grounding.mapping ?? {}).length;
      const unmatchedCount = grounding.unmatched.length;
      activity.push(
        withTimestamp({
          type: 'knowledge_agent_grounding',
          description: `Unified grounding mapped ${mappedCount} id(s); unmatched ${unmatchedCount}.`
        })
      );
    }

    references = (agentResult.references ?? []).slice(0, Math.max(baseTop * 2, baseTop));
    answer = agentResult.answer;

    // Apply reranker threshold if scores are present
    if (references.some((ref) => typeof ref.score === 'number')) {
      const enforcement = enforceRerankerThreshold(references, config.RERANKER_THRESHOLD, {
        correlationId: agentCorrelationId,
        source: 'knowledge_agent'
      });
      references = enforcement.references;
    }
    recordThreshold(config.RERANKER_THRESHOLD);

    const summaryDescription = `Knowledge agent returned ${references.length} result(s). [correlation=${agentCorrelationId}]`;
    activity.push(
      withTimestamp({
        type: 'knowledge_agent_search',
        description: summaryDescription
      })
    );

    // Check if results meet minimum requirements
    if (references.length >= minDocs) {
      console.info(
        JSON.stringify({
          event: 'knowledge_agent.success',
          correlationId: agentCorrelationId,
          requestId,
          documents: references.length,
          minDocs
        })
      );
      // Return with fallbackTriggered: false to indicate success
      return {
        references,
        activity,
        answer,
        grounding,
        correlationId: agentCorrelationId,
        requestId,
        fallbackTriggered: false
      };
    }

    // Insufficient results - trigger fallback
    fallbackTriggered = true;

    if (!references.length) {
      failurePhase = 'zero_results';
      const description = `Knowledge agent returned 0 result(s); falling back to direct search. [correlation=${agentCorrelationId}]`;
      activity.push(
        withTimestamp({
          type: 'knowledge_agent_fallback',
          description
        })
      );
      console.warn(
        JSON.stringify({
          event: 'knowledge_agent.fallback',
          correlationId: agentCorrelationId,
          requestId,
          reason: 'zero_results',
          minDocs,
          returned: 0
        })
      );
    } else {
      failurePhase = 'partial_results';
      const description = `Knowledge agent returned ${references.length} result(s); supplementing with direct search. [correlation=${agentCorrelationId}]`;
      activity.push(
        withTimestamp({
          type: 'knowledge_agent_partial',
          description
        })
      );
      console.warn(
        JSON.stringify({
          event: 'knowledge_agent.fallback',
          correlationId: agentCorrelationId,
          requestId,
          reason: 'insufficient_results',
          minDocs,
          returned: references.length
        })
      );
    }
  } catch (agentError) {
    fallbackTriggered = true;
    failurePhase = 'invocation';

    const errorCorrelation = (agentError as { correlationId?: string }).correlationId;
    if (errorCorrelation) {
      agentCorrelationId = errorCorrelation;
    }

    statusCode =
      typeof (agentError as { status?: number }).status === 'number'
        ? (agentError as { status: number }).status
        : typeof (agentError as { statusCode?: number }).statusCode === 'number'
        ? (agentError as { statusCode: number }).statusCode
        : undefined;

    errorMessage = agentError instanceof Error ? agentError.message : String(agentError);
    requestId = (agentError as { requestId?: string }).requestId ?? requestId;

    const sanitizedError = sanitizeLogMessage(errorMessage ?? 'Unknown error');
    const errorDescription = `Knowledge agent failed [correlation=${agentCorrelationId}${
      statusCode ? ` status=${statusCode}` : ''
    }]: ${sanitizedError}`;

    activity.push(
      withTimestamp({
        type: 'knowledge_agent_error',
        description: errorDescription
      })
    );

    console.error(
      JSON.stringify({
        event: 'knowledge_agent.failure',
        correlationId: agentCorrelationId,
        requestId,
        statusCode,
        message: sanitizedError,
        fallbackTriggered: true,
        messagesLength: agentMessages.length
      })
    );
  }

  return {
    references,
    activity,
    answer,
    grounding,
    correlationId: agentCorrelationId,
    requestId,
    statusCode,
    errorMessage,
    failurePhase,
    fallbackTriggered
  };
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
  let knowledgeAgentCorrelationId: string = correlationId;
  let knowledgeAgentAttempted = false;
  let knowledgeAgentGrounding: KnowledgeAgentGroundingSummary | undefined;
  let knowledgeAgentAnswer: string | undefined;
  let thresholdUsed = config.RERANKER_THRESHOLD;
  const thresholdHistory: number[] = [];
  let maxRetryAttempt = 0;
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
    diagnostics.retryCount = Math.max(diagnostics.retryCount ?? 0, maxRetryAttempt);
    if (fallbackTriggered) {
      diagnostics.knowledgeAgentSummaryProvided = false;
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

    response.diagnostics = response.diagnostics ?? buildDiagnostics();
    response.diagnostics!.retryCount = Math.max(response.diagnostics!.retryCount ?? 0, maxRetryAttempt);

    if (knowledgeAgentGrounding && response.knowledgeAgentGrounding === undefined && !fallbackTriggered) {
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

    if (fallbackTriggered) {
      response.knowledgeAgentAnswer = undefined;
      response.knowledgeAgentSummaryProvided = false;
      response.diagnostics!.knowledgeAgentSummaryProvided = false;
    } else if (response.knowledgeAgentSummaryProvided === undefined) {
      const candidateSummary = response.knowledgeAgentAnswer ?? knowledgeAgentAnswer;
      response.knowledgeAgentSummaryProvided = Boolean(
        typeof candidateSummary === 'string' && candidateSummary.trim().length > 0
      );
    }

    return response;
  };

  const runFallbackPipeline = async (
    existingActivity: ActivityStep[],
    signal: AbortSignal
  ): Promise<{ references: Reference[]; activity: ActivityStep[]; threshold: number }> => {
    fallbackTriggered = true;
    knowledgeAgentAnswer = undefined;
    knowledgeAgentGrounding = undefined;
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
      correlationId,
      signal
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
      correlationId,
      signal
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
      filter,
      signal
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
    // Knowledge Agent operations need 60s timeout (Azure recommendation)
    // Regular search operations use 30s default
    const retryTimeout = knowledgeAgentPreferred ? 60000 : 30000;

    return await withRetry('direct-search', async (signal, context) => {
      const retryAttempt = context?.attempt ?? 0;
      maxRetryAttempt = Math.max(maxRetryAttempt, retryAttempt);
      knowledgeAgentGrounding = undefined;
      knowledgeAgentAnswer = undefined;
      let knowledgeAgentReferences: Reference[] = [];
      const knowledgeAgentActivity: ActivityStep[] = [];

      // Skip Knowledge Agent on retries if it aborted on first attempt
      // to avoid wasting time retrying a consistently slow/failing endpoint
      const skipKnowledgeAgentDueToAbort = retryAttempt > 0 && knowledgeAgentFailurePhase === 'invocation';

      if (skipKnowledgeAgentDueToAbort) {
        console.info(
          JSON.stringify({
            event: 'knowledge_agent.skipped_on_retry',
            correlationId,
            retryAttempt,
            reason: 'Previous invocation failed, using direct search fallback'
          })
        );
      }

      // PATTERN 3: Hybrid Retrieval - Parallel KB + Web Search
      const enableHybridWeb =
        (features?.ENABLE_HYBRID_WEB_RETRIEVAL ?? config.ENABLE_HYBRID_WEB_RETRIEVAL) === true;

      // Analyze if fresh web data is needed
      let webReferences: Reference[] = [];
      const webActivity: ActivityStep[] = [];
      let freshnessAnalysis: any = null;

      if (enableHybridWeb) {
        const { analyzeFreshness } = await import('../utils/freshness-detector.js');
        const conversationContext = messages?.map((m) => m.content).filter(Boolean) || [];
        freshnessAnalysis = analyzeFreshness(query, conversationContext);

        console.info(
          JSON.stringify({
            event: 'freshness_analysis',
            correlationId,
            needsFreshData: freshnessAnalysis.needsFreshData,
            confidence: freshnessAnalysis.confidence,
            signals: freshnessAnalysis.signals
          })
        );
      }

      // Run KB retrieval and Web search in parallel if needed
      const kbPromise =
        knowledgeAgentPreferred && !skipKnowledgeAgentDueToAbort
          ? (async () => {
              knowledgeAgentAttempted = true;
              return await handleKnowledgeAgentRetrieval({
                messages,
                query,
                filter,
                correlationId,
                signal,
                retryAttempt,
                baseTop,
                minDocs,
                recordThreshold
              });
            })()
          : null;

      const webPromise =
        enableHybridWeb && freshnessAnalysis?.needsFreshData
          ? (async () => {
              try {
                const { webSearchTool } = await import('./webSearch.js');
                const { convertWebResultsToReferences } = await import('./webSearch.js');

                webActivity.push(
                  withTimestamp({
                    type: 'hybrid_web_search',
                    description: `Parallel web search triggered (freshness confidence: ${(freshnessAnalysis.confidence * 100).toFixed(0)}%)`
                  })
                );

                const webSearchMode = freshnessAnalysis.confidence > 0.7 ? 'hyperbrowser_extract' : 'hyperbrowser_scrape';

                const webResults = await webSearchTool({
                  query,
                  count: 5,
                  mode: webSearchMode
                });

                return convertWebResultsToReferences(webResults.results);
              } catch (error) {
                console.warn(
                  JSON.stringify({
                    event: 'hybrid_web_search.failure',
                    correlationId,
                    message: error instanceof Error ? error.message : String(error)
                  })
                );
                return [];
              }
            })()
          : null;

      // Wait for parallel operations while preserving tuple ordering
      const [kaResultRaw, webResultsRaw] = await Promise.all([
        kbPromise ?? Promise.resolve(null),
        webPromise ?? Promise.resolve(null)
      ]);
      let kaResult: Awaited<ReturnType<typeof handleKnowledgeAgentRetrieval>> | null = null;

      // Process Knowledge Agent results
      if (kaResultRaw && typeof kaResultRaw === 'object' && 'references' in kaResultRaw) {
        kaResult = kaResultRaw as Awaited<ReturnType<typeof handleKnowledgeAgentRetrieval>>;
        knowledgeAgentReferences = kaResult.references;
        knowledgeAgentActivity.push(...kaResult.activity);
        knowledgeAgentAnswer = kaResult.answer;
        knowledgeAgentGrounding = kaResult.grounding;
        knowledgeAgentCorrelationId = kaResult.correlationId;
        knowledgeAgentRequestId = kaResult.requestId;
        knowledgeAgentStatusCode = kaResult.statusCode;
        knowledgeAgentErrorMessage = kaResult.errorMessage;
        knowledgeAgentFailurePhase = kaResult.failurePhase;

        if (kaResult.fallbackTriggered) {
          fallbackTriggered = true;
        }
      }

      // Process web results
      if (Array.isArray(webResultsRaw) && webResultsRaw.length > 0) {
        webReferences = webResultsRaw;
        webActivity.push(
          withTimestamp({
            type: 'hybrid_web_results',
            description: `Web search returned ${webReferences.length} result(s)`
          })
        );
      }

      // Merge KB and Web results if both available
      if (enableHybridWeb && knowledgeAgentReferences.length > 0 && webReferences.length > 0) {
        const { mergeKBAndWebResults } = await import('../utils/result-merger.js');
        const { shouldPreferFreshSources } = await import('../utils/freshness-detector.js');

        const preferFresh = shouldPreferFreshSources(freshnessAnalysis);

        const merged = mergeKBAndWebResults(knowledgeAgentReferences, webReferences, {
          preferFresh,
          maxResults: baseTop
        });

        const activity: ActivityStep[] = [...knowledgeAgentActivity, ...webActivity];
        activity.push(
          withTimestamp({
            type: 'hybrid_merge',
            description: `Merged KB (${knowledgeAgentReferences.length}) + Web (${webReferences.length}) → ${merged.references.length} results (duplicates: ${merged.stats.duplicatesRemoved})`
          })
        );

        const hybridExtras: Partial<AgenticRetrievalResponse> = {
          response: knowledgeAgentAnswer ?? '',
          mode: 'hybrid_kb_web',
          strategy: retrievalStrategy,
          knowledgeAgentAnswer,
          freshnessAnalysis,
          mergeStats: merged.stats
        };

        if (knowledgeAgentGrounding) {
          hybridExtras.knowledgeAgentGrounding = knowledgeAgentGrounding;
        }

        return finalize(merged.references, activity, hybridExtras);
      }

      // If only KB results available, return them if sufficient
      if (kaResult && 'fallbackTriggered' in kaResult && !kaResult.fallbackTriggered && knowledgeAgentReferences.length >= minDocs) {
        const successExtras: Partial<AgenticRetrievalResponse> = {
          response: knowledgeAgentAnswer ?? '',
          mode: 'knowledge_agent',
          strategy: retrievalStrategy,
          knowledgeAgentAnswer
        };
        if (knowledgeAgentGrounding) {
          successExtras.knowledgeAgentGrounding = knowledgeAgentGrounding;
        }
        const activity: ActivityStep[] = [...knowledgeAgentActivity];
        return finalize(knowledgeAgentReferences.slice(0, baseTop), activity, successExtras);
      }

      // If only web results available, return them
      if (webReferences.length > 0 && (!kaResult || knowledgeAgentReferences.length === 0)) {
        const activity: ActivityStep[] = [...webActivity];
        return finalize(webReferences.slice(0, baseTop), activity, {
          mode: 'web_only',
          freshnessAnalysis
        });
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
            minDiversity: config.ADAPTIVE_MIN_DIVERSITY,
            signal
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

        const fallbackOutcome = await runFallbackPipeline(adaptiveActivity, signal);
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
        correlationId,
        signal
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
      const fallbackOutcome = await runFallbackPipeline(primaryActivity, signal);
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
    }, { timeoutMs: retryTimeout });
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
