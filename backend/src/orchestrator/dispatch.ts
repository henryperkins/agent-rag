import { performance } from 'node:perf_hooks';
import type {
  AgentMessage,
  PlanSummary,
  Reference,
  ActivityStep,
  WebResult,
  WebSearchResponse,
  LazyReference,
  FeatureOverrideMap,
  AgenticRetrievalDiagnostics,
  KnowledgeAgentGroundingSummary,
  CitationMetadata
} from '../../../shared/types.js';
import { retrieveTool, webSearchTool, lazyRetrieveTool } from '../tools/index.js';
import { selectRetrievalStrategy } from '../retrieval/selectStrategy.js';
import { mapToTelemetryResult } from './telemetry/mapResult.js';
import type { SalienceNote } from './compact.js';
import { config } from '../config/app.js';
import { estimateTokens } from './contextBudget.js';
import { reciprocalRankFusion, applySemanticBoost } from './reranker.js';
import { embedText } from '../utils/embeddings.js';
import { filterWebResults } from '../tools/webQualityFilter.js';
import type { FeatureGates } from '../config/features.js';
import type { AdaptiveRetrievalStats } from '../../../shared/types.js';
import { applyCRAG } from './CRAG.js';

export interface DispatchResult {
  contextText: string;
  references: Reference[];
  lazyReferences: LazyReference[];
  activity: ActivityStep[];
  webResults: WebResult[];
  webContextText: string;
  webContextTokens: number;
  webContextTrimmed: boolean;
  summaryTokens?: number;
  knowledgeAgentAnswer?: string;
  contextSectionLabels?: string[];
  coverageChecklistCount?: number;
  source: 'direct' | 'fallback_vector' | 'knowledge_agent';
  retrievalMode: 'direct' | 'lazy' | 'knowledge_agent';
  strategy: 'direct' | 'knowledge_agent' | 'hybrid';
  escalated: boolean;
  adaptiveStats?: AdaptiveRetrievalStats;
  diagnostics?: AgenticRetrievalDiagnostics;
  knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
  retrievalThresholdUsed?: number;
  retrievalThresholdHistory?: number[];
  retrievalLatencyMs?: number;
  citationMetadata?: CitationMetadata; // F-001: Citation enumeration tracking
}

interface DispatchOptions {
  plan: PlanSummary;
  messages: AgentMessage[];
  salience: SalienceNote[];
  emit?: (event: string, data: unknown) => void;
  features: FeatureGates;
  featureStates: FeatureOverrideMap;
  tools?: {
    retrieve?: (args: {
      query: string;
      filter?: string;
      top?: number;
      messages?: AgentMessage[];
      features?: FeatureOverrideMap;
    }) => Promise<{
      response: string;
      references: Reference[];
      activity: ActivityStep[];
      lazyReferences?: LazyReference[];
      summaryTokens?: number;
      mode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
      fullContentAvailable?: boolean;
      diagnostics?: AgenticRetrievalDiagnostics;
    }>;
    lazyRetrieve?: (args: { query: string; filter?: string; top?: number }) => Promise<{
      response: string;
      references: Reference[];
      activity: ActivityStep[];
      lazyReferences?: LazyReference[];
      summaryTokens?: number;
      mode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
      fullContentAvailable?: boolean;
      diagnostics?: AgenticRetrievalDiagnostics;
    }>;
    webSearch?: (args: { query: string; count?: number; mode?: 'summary' | 'full' | 'hyperbrowser_scrape' | 'hyperbrowser_extract' }) => Promise<WebSearchResponse>;
  };
  preferLazy?: boolean;
}

/**
 * F-001: Build unified citation block with contiguous numbering for retrieval + web sources
 * This ensures both retrieval and web sources are properly enumerated in the context
 */
interface EnumeratedCitations {
  referenceBlock: string;
  citationMetadata: CitationMetadata;
}

function buildUnifiedCitationBlock(
  retrievalRefs: Reference[],
  webResults: WebResult[],
  isLazy: boolean
): EnumeratedCitations {
  const citationMap: Record<number, { source: 'retrieval' | 'web'; index: number }> = {};
  let currentIndex = 1;
  const blocks: string[] = [];

  // Helper to build reference entry with rich content
  function buildEntry(ref: Reference | WebResult): string {
    const label = `[${currentIndex}]`;
    const lines: string[] = [];

    // Title
    const title = normalizeString(ref.title);
    if (title) {
      lines.push(`Title: ${title}`);
    }

    // Source/URL
    const url = 'url' in ref ? normalizeString(ref.url) : undefined;
    const metadata = 'metadata' in ref ? ref.metadata : undefined;
    const docKey =
      extractMetadataString(metadata, ['docKey', 'documentId', 'sourceId']) ??
      extractMetadataString(metadata, ['id']);
    const locationParts = [docKey, url].filter(Boolean);
    if (locationParts.length) {
      lines.push(`Source: ${locationParts.join(' · ')}`);
    }

    // Content from multiple sources
    const contentCandidates: Array<string | undefined> = [];

    if ('content' in ref) {
      contentCandidates.push(ref.content);
    }
    if ('chunk' in ref) {
      contentCandidates.push(ref.chunk);
    }
    if ('snippet' in ref) {
      contentCandidates.push(ref.snippet);
    }
    if ('summary' in ref) {
      contentCandidates.push(normalizeString((ref as LazyReference).summary));
    }

    // Captions
    if ('captions' in ref && Array.isArray(ref.captions)) {
      const captionText = ref.captions
        .map((caption) => normalizeString(caption.text))
        .filter((segment): segment is string => Boolean(segment))
        .join(' ');
      if (captionText) {
        contentCandidates.push(captionText);
      }
    }

    // Highlights
    if ('highlights' in ref && ref.highlights) {
      const highlightText = Object.values(ref.highlights)
        .flat()
        .map((segment) => normalizeString(segment))
        .filter((segment): segment is string => Boolean(segment))
        .join(' ');
      if (highlightText) {
        contentCandidates.push(`Highlights: ${highlightText}`);
      }
    }

    // Deduplicate and add content
    const bodySegments = contentCandidates
      .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
      .filter((segment) => segment.length > 0);

    const uniqueSegments: string[] = [];
    const seen = new Set<string>();
    for (const segment of bodySegments) {
      if (seen.has(segment)) {
        continue;
      }
      seen.add(segment);
      uniqueSegments.push(segment);
    }

    if (uniqueSegments.length) {
      lines.push(uniqueSegments.join('\n'));
    }

    if (!lines.length) {
      return `${label} Untitled`;
    }

    return `${label} ${lines.join('\n')}`;
  }

  // Enumerate retrieval sources
  if (retrievalRefs.length > 0) {
    const retrievalEntries = retrievalRefs.map((ref, idx) => {
      citationMap[currentIndex] = { source: 'retrieval', index: idx };
      const entry = buildEntry(ref);
      currentIndex++;
      return entry;
    });

    const label = isLazy ? 'Retrieved Knowledge (summaries)' : 'Retrieved Knowledge';
    blocks.push(`### ${label}\n${retrievalEntries.join('\n\n')}`);
  }

  // Enumerate web sources with contiguous numbering
  if (webResults.length > 0) {
    const webEntries = webResults.map((result, idx) => {
      citationMap[currentIndex] = { source: 'web', index: idx };
      const entry = buildEntry(result);
      currentIndex++;
      return entry;
    });

    blocks.push(`### Web Sources\n${webEntries.join('\n\n')}`);
  }

  return {
    referenceBlock: blocks.join('\n\n'),
    citationMetadata: {
      citationMap,
      totalCount: currentIndex - 1
    }
  };
}

export function buildWebContext(results: WebResult[], maxTokens: number) {
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function extractMetadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!metadata) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = normalizeString(metadata[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

// F-001: buildReferenceEntry removed - replaced by buildEntry in buildUnifiedCitationBlock

function latestUserQuery(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return last?.content ?? '';
}

export async function dispatchTools({
  plan,
  messages,
  salience,
  emit,
  tools,
  preferLazy,
  features,
  featureStates
}: DispatchOptions): Promise<DispatchResult> {
  const references: Reference[] = [];
  const lazyReferences: LazyReference[] = [];
  const activity: ActivityStep[] = [];
  const webResults: WebResult[] = [];
  const retrievalSnippets: string[] = [];
  let adaptiveStats: AdaptiveRetrievalStats | undefined;
  let source: 'direct' | 'fallback_vector' | 'knowledge_agent' = 'direct';
  let retrievalMode: 'direct' | 'lazy' | 'knowledge_agent' = 'direct';
  let strategy: 'direct' | 'knowledge_agent' | 'hybrid' = 'direct';
  let summaryTokens: number | undefined;
  const confidence = typeof plan.confidence === 'number' ? plan.confidence : 1;
  const threshold = config.PLANNER_CONFIDENCE_DUAL_RETRIEVAL;
  const escalated = confidence < threshold;
  let diagnostics: AgenticRetrievalDiagnostics | undefined;
  let knowledgeAgentGrounding: KnowledgeAgentGroundingSummary | undefined;
  let retrievalThresholdUsed: number | undefined;
  let retrievalThresholdHistory: number[] | undefined;
  let knowledgeAgentAnswer: string | undefined;
  let retrievalLatencyMs: number | undefined;
  let contextSectionLabels: string[] | undefined;
  let coverageChecklistCount: number | undefined;

  const queryFallback = latestUserQuery(messages);
  const retrieve = tools?.retrieve ?? retrieveTool;
  const lazyRetrieve = tools?.lazyRetrieve ?? lazyRetrieveTool;
  const webSearch = tools?.webSearch ?? webSearchTool;

  if (escalated) {
    emit?.('status', { stage: 'confidence_escalation', confidence, threshold });
    activity.push({
      type: 'confidence_escalation',
      description: `Confidence ${confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}. Executing dual retrieval.`
    });
  }

  const shouldRetrieve = escalated || plan.steps.some((step) => step.action === 'vector_search' || step.action === 'both');
  if (shouldRetrieve) {
    emit?.('status', { stage: 'retrieval' });
    // Extract query from plan step or use latest user query
    const retrievalStep = plan.steps.find((s) => s.action === 'vector_search' || s.action === 'both');
    const query = retrievalStep?.query?.trim() || queryFallback;
    const wantsLazy = (preferLazy ?? features.lazyRetrieval) === true;
    const supportsLazy = typeof lazyRetrieve === 'function';
    // Disable lazy mode when Knowledge Agent is preferred (strategy=knowledge_agent or hybrid)
    // to ensure the agentic retrieval path in retrieveTool is executed
    const retrievalStrategy = selectRetrievalStrategy(config, messages);
    const knowledgeAgentPreferred = retrievalStrategy === 'knowledge_agent' || retrievalStrategy === 'hybrid';
    const useLazy = wantsLazy && supportsLazy && !knowledgeAgentPreferred;

    const retrievalStart = performance.now();
    let retrieval;
    let lazyRetrievalFailed = false;
    if (useLazy) {
      try {
        retrieval = await lazyRetrieve({ query, top: retrievalStep?.k });
      } catch (error) {
        lazyRetrievalFailed = true;
        const errorDetails = {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          query: query.substring(0, 100),
          top: retrievalStep?.k
        };
        console.error('[DISPATCH_ERROR] Lazy retrieval failed, falling back to direct retrieval:', errorDetails);

        // Emit telemetry for lazy retrieval failure
        emit?.('telemetry', {
          type: 'lazy_retrieval_error',
          timestamp: new Date().toISOString(),
          error: errorDetails
        });

        // Fallback to direct retrieval
        retrieval = await retrieve({ query, messages, features: featureStates });
      }
    } else {
      retrieval = await retrieve({ query, messages, features: featureStates });
    }

    if (retrieval && (retrieval as any).knowledgeAgentGrounding) {
      knowledgeAgentGrounding = (retrieval as any).knowledgeAgentGrounding as KnowledgeAgentGroundingSummary;
    }
    if (typeof (retrieval as any).thresholdUsed === 'number') {
      retrievalThresholdUsed = (retrieval as any).thresholdUsed as number;
    }
    if (Array.isArray((retrieval as any).thresholdHistory)) {
      retrievalThresholdHistory = [...((retrieval as any).thresholdHistory as number[])];
    }

    references.push(...(retrieval.references ?? []));
    if ('lazyReferences' in retrieval && Array.isArray(retrieval.lazyReferences) && retrieval.lazyReferences.length) {
      lazyReferences.push(...retrieval.lazyReferences);
      summaryTokens = retrieval.summaryTokens;
      retrievalMode =
        retrieval.mode === 'lazy' || retrieval.mode === 'knowledge_agent'
          ? retrieval.mode
          : 'direct';
    }
    if ('diagnostics' in retrieval && retrieval.diagnostics) {
      diagnostics = retrieval.diagnostics;

      // Emit real-time telemetry for knowledge agent fallback
      if (diagnostics.knowledgeAgent?.fallbackTriggered) {
        emit?.('telemetry', {
          type: 'knowledge_agent_fallback',
          timestamp: new Date().toISOString(),
          data: {
            correlationId: diagnostics.correlationId,
            reason: diagnostics.knowledgeAgent.failurePhase,
            requestId: diagnostics.knowledgeAgent.requestId,
            statusCode: diagnostics.knowledgeAgent.statusCode,
            attempted: diagnostics.knowledgeAgent.attempted
          }
        });
      }
    }

    retrievalLatencyMs = Math.round(performance.now() - retrievalStart);

    activity.push(
      ...(retrieval.activity ?? []),
      {
        type: useLazy && !lazyRetrievalFailed ? 'plan' : lazyRetrievalFailed ? 'lazy_retrieval_fallback' : knowledgeAgentPreferred ? 'knowledge_agent_preferred' : 'plan',
        description: useLazy && !lazyRetrievalFailed
          ? 'Lazy Azure AI Search retrieval executed via orchestrator.'
          : lazyRetrievalFailed
          ? 'Lazy retrieval failed, fell back to direct Azure AI Search retrieval.'
          : knowledgeAgentPreferred
          ? `Direct retrieval with ${retrievalStrategy} strategy (lazy mode bypassed for Knowledge Agent path).`
          : 'Direct Azure AI Search retrieval executed via orchestrator.'
      }
    );
    if (typeof retrieval.response === 'string' && retrieval.response.trim().length) {
      retrievalSnippets.push(retrieval.response.trim());
    }
    if (retrieval.activity?.some((step) => step.type === 'fallback_search')) {
      source = 'fallback_vector';

      // Emit real-time telemetry for vector search fallback
      emit?.('telemetry', {
        type: 'retrieval_fallback',
        timestamp: new Date().toISOString(),
        data: {
          from: 'hybrid_semantic',
          to: 'pure_vector',
          reason: 'reranker_threshold_not_met'
        }
      });
    }
    if (retrieval.mode === 'knowledge_agent') {
      source = 'knowledge_agent';
      retrievalMode = 'knowledge_agent';
    }
    if ('strategy' in retrieval && retrieval.strategy) {
      const retrievalStrategy = retrieval.strategy;
      if (retrievalStrategy === 'direct' || retrievalStrategy === 'knowledge_agent' || retrievalStrategy === 'hybrid') {
        strategy = retrievalStrategy;
      }
    } else if (retrieval.mode === 'knowledge_agent') {
      strategy = 'knowledge_agent';
    }
    if (retrieval as any && (retrieval as any).adaptiveStats) {
      adaptiveStats = (retrieval as any).adaptiveStats as AdaptiveRetrievalStats;
    }
    if (adaptiveStats && emit) {
      // Emit adaptive retrieval telemetry for real-time monitoring
      try {
        emit('telemetry', { adaptive_retrieval: adaptiveStats });
      } catch {
        // Ignore telemetry emission errors to prevent disrupting retrieval flow
      }
    }
    const candidateKnowledgeAnswer =
      typeof (retrieval as any).knowledgeAgentAnswer === 'string'
        ? (retrieval as any).knowledgeAgentAnswer.trim()
        : '';
    if (candidateKnowledgeAnswer) {
      knowledgeAgentAnswer = candidateKnowledgeAnswer;
    }
  }

  // CRAG: Self-grading retrieval evaluation
  let cragTriggeredWebSearch = false;
  if (config.ENABLE_CRAG && shouldRetrieve && references.length > 0) {
    emit?.('status', { stage: 'crag_evaluation' });
    try {
      const cragResult = await applyCRAG(queryFallback, references);

      // Add CRAG activity steps
      activity.push(...cragResult.activity);
      if (cragResult.reasoningSummary) {
        activity.push({
          type: 'insight',
          description: `[CRAG] ${cragResult.reasoningSummary}`,
          timestamp: new Date().toISOString()
        });
      }

      // Handle CRAG corrective actions
      if (cragResult.refinedDocuments && cragResult.refinedDocuments.length > 0) {
        // Replace references with refined documents
        references.length = 0;
        references.push(...cragResult.refinedDocuments);
      }

      // If CRAG recommends web fallback, trigger web search
      if (cragResult.shouldTriggerWebSearch) {
        cragTriggeredWebSearch = true;
      }
    } catch (error: any) {
      console.error('CRAG evaluation failed:', error.message);
      activity.push({
        type: 'crag_error',
        description: `CRAG evaluation failed: ${error.message}. Proceeding without correction.`
      });
    }
  }

  // Browser Agent for Complex Research Tasks
  const wantsBrowserAgent = config.ENABLE_BROWSER_AGENT && plan.steps.some((step) => step.action === 'browser_agent');
  if (wantsBrowserAgent) {
    emit?.('status', { stage: 'browser_agent' });
    const step = plan.steps.find((s) => s.action === 'browser_agent');
    const query = step?.query?.trim() || queryFallback;

    try {
      // Dynamically import browserAgentTool to avoid circular dependencies
      const { browserAgentTool, shouldUseBrowserAgent } = await import('../tools/browserAgent.js');

      // Double-check if browser agent should be used (confidence + complexity checks)
      const shouldProceed = shouldUseBrowserAgent(query, plan.confidence, plan.steps.length);

      if (shouldProceed) {
        activity.push({
          type: 'browser_agent_start',
          description: `Launching autonomous browser agent for complex research task.`
        });

        const browserResult = await browserAgentTool({
          query,
          context: '', // Context will be merged later in synthesis
          messages,
          options: {
            maxSteps: step?.k || config.BROWSER_AGENT_MAX_STEPS,
            agentType: config.BROWSER_AGENT_DEFAULT_TYPE,
            sessionOptions: {
              useStealth: config.HYPERBROWSER_USE_STEALTH,
              useProxy: config.HYPERBROWSER_USE_PROXY,
            },
          },
        });

        // Add browser agent results to references
        references.push(...browserResult.references);
        activity.push(...browserResult.activity);

        // Store browser agent answer for later context assembly
        if (browserResult.answer) {
          retrievalSnippets.push(`# Browser Agent Research\n${browserResult.answer}`);
        }

        activity.push({
          type: 'browser_agent_complete',
          description: `Browser agent completed with ${browserResult.references.length} sources (${browserResult.metadata?.totalSteps ?? 0} steps).`
        });

        emit?.('telemetry', {
          type: 'browser_agent',
          timestamp: new Date().toISOString(),
          data: {
            agentType: browserResult.metadata?.agentType,
            totalSteps: browserResult.metadata?.totalSteps,
            sourcesFound: browserResult.references.length,
            sessionId: browserResult.metadata?.sessionId,
          }
        });
      } else {
        activity.push({
          type: 'browser_agent_skipped',
          description: `Browser agent skipped (confidence ${plan.confidence.toFixed(2)} >= threshold, using web search instead).`
        });
      }
    } catch (error) {
      console.error('Browser agent failed:', error);
      activity.push({
        type: 'browser_agent_error',
        description: `Browser agent failed: ${error instanceof Error ? error.message : String(error)}. Falling back to web search.`
      });
      // Don't throw - fall through to web search
    }
  }

  const wantsWeb = cragTriggeredWebSearch || escalated || plan.steps.some((step) => step.action === 'web_search' || step.action === 'both');
  let webContextText = '';
  let webContextTokens = 0;
  let webContextTrimmed = false;
  if (wantsWeb) {
    emit?.('status', { stage: 'web_search' });
    const step = plan.steps.find((s) => s.action === 'web_search' || s.action === 'both');
    const query = step?.query?.trim() || queryFallback;
    const count = step?.k ?? config.WEB_RESULTS_MAX;

    // Detect academic queries and use multi-source academic search
    const academicKeywords = ['paper', 'research', 'study', 'publication', 'article', 'scholar', 'journal', 'arxiv', 'academic'];
    const isAcademicQuery = config.ENABLE_ACADEMIC_SEARCH && academicKeywords.some(keyword => query.toLowerCase().includes(keyword));

    try {
      let search: WebSearchResponse;

      if (isAcademicQuery) {
        // Use multi-source academic search (Semantic Scholar + arXiv)
        // Dynamic import to avoid issues with axios in test environments
        const { multiSourceAcademicSearch } = await import('../tools/multiSourceWeb.js');
        const academicResult = await multiSourceAcademicSearch({
          query,
          maxResults: config.ACADEMIC_SEARCH_MAX_RESULTS
        });

        // Convert to WebSearchResponse format
        search = {
          results: academicResult.results.map((r, i) => ({
            ...r,
            id: `academic_${i}`,
            fetchedAt: new Date().toISOString()
          })),
          contextText: '',
          tokens: 0,
          trimmed: false
        };

        activity.push({
          type: 'academic_search',
          description: `Fetched ${academicResult.totalResults} academic papers (${academicResult.sources.semanticScholar} from Semantic Scholar, ${academicResult.sources.arxiv} from arXiv).`
        });

        // Emit dedicated telemetry event for academic search
        emit?.('telemetry', {
          type: 'academic_search',
          timestamp: new Date().toISOString(),
          data: {
            totalResults: academicResult.totalResults,
            sources: {
              semanticScholar: academicResult.sources.semanticScholar,
              arxiv: academicResult.sources.arxiv
            },
            query: query.slice(0, 100)
          }
        });
      } else {
        // Use regular web search
        search = await webSearch({ query, count, mode: config.WEB_SEARCH_MODE as 'summary' | 'full' | 'hyperbrowser_scrape' | 'hyperbrowser_extract' });
      }
      if (search.results?.length) {
        let resultsToUse = search.results;

        if (config.ENABLE_WEB_QUALITY_FILTER) {
          try {
            const qualityFiltered = await filterWebResults(resultsToUse, query, references);
            if (qualityFiltered.removed > 0) {
              activity.push({
                type: 'web_quality_filter',
                description: `Filtered ${qualityFiltered.removed} low-quality web results (${qualityFiltered.filtered.length} remaining).`
              });
              resultsToUse = qualityFiltered.filtered;
            }
          } catch (error) {
            console.warn('Web quality filtering failed:', error);
          }
        }

        webResults.push(...resultsToUse);
        activity.push({
          type: 'web_search',
          description: `Fetched ${resultsToUse.length} web results for "${query}".`
        });

        if (search.contextText) {
          webContextText = search.contextText;
          webContextTokens = search.tokens ?? estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, search.contextText);
          webContextTrimmed = Boolean(search.trimmed);
          emit?.('web_context', {
            tokens: webContextTokens,
            trimmed: webContextTrimmed,
            results: search.results.map((result) => mapToTelemetryResult(result)),
            text: search.contextText
          });

          // Always emit token tracking telemetry
          emit?.('telemetry', {
            type: 'web_context_tokens',
            timestamp: new Date().toISOString(),
            data: {
              totalResults: search.results.length,
              tokensUsed: webContextTokens,
              tokensRequested: config.WEB_CONTEXT_MAX_TOKENS,
              trimmed: webContextTrimmed
            }
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

            // Emit dedicated telemetry event for web context trimming
            emit?.('telemetry', {
              type: 'web_context_trim',
              timestamp: new Date().toISOString(),
              data: {
                totalResults: search.results.length,
                usedResults: usedResults.length,
                tokensUsed: tokens,
                tokensRequested: config.WEB_CONTEXT_MAX_TOKENS,
                trimmed: true
              }
            });
          }

          emit?.('web_context', {
            tokens,
            trimmed,
            results: usedResults.map((result) => mapToTelemetryResult(result)),
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

  // F-001 P0 Fix: Track whether RRF was applied to avoid double-enumerating web citations
  let webRerankingApplied = false;

  if (features.webReranking && references.length > 0 && webResults.length > 0) {
    webRerankingApplied = true; // Mark that web results are now merged into references
    const originalAzureCount = references.length;
    const originalWebCount = webResults.length;
    const originalAzureMap = new Map(
      references.map((ref, index) => [ref.id ?? `azure-${index}`, ref])
    );
    const originalWebMap = new Map(
      webResults.map((result, index) => [result.id ?? result.url ?? `web-${index}`, result])
    );

    emit?.('status', { stage: 'reranking' });
    let reranked = reciprocalRankFusion(references, webResults, config.RRF_K_CONSTANT);

    if (features.semanticBoost) {
      try {
        const queryEmbedding = await embedText(queryFallback);
        const documentEmbeddings = new Map<string, number[]>();
        const boostCandidates = reranked.slice(0, config.RERANKING_TOP_K);

        for (const candidate of boostCandidates) {
          const content = candidate.content?.slice(0, 1000);
          if (content) {
            const embedding = await embedText(content);
            documentEmbeddings.set(candidate.id, embedding);
          }
        }

        reranked = applySemanticBoost(
          reranked,
          queryEmbedding,
          documentEmbeddings,
          config.SEMANTIC_BOOST_WEIGHT
        );
      } catch (error) {
        console.warn('Semantic boost failed during reranking:', error);
      }
    }

    const topReranked = reranked.slice(0, config.RERANKING_TOP_K);

    references.splice(
      0,
      references.length,
      ...topReranked.map((item) => {
        const original = originalAzureMap.get(item.id);
        return {
          id: item.id,
          title: item.title ?? original?.title,
          content: item.content || original?.content || original?.chunk || '',
          chunk: original?.chunk,
          url: item.url ?? original?.url,
          page_number: original?.page_number,
          score: item.rrfScore
        } satisfies Reference;
      })
    );

    const rerankedWebResults = topReranked
      .filter((item) => item.source === 'web')
      .map((item, index) => {
        const original = originalWebMap.get(item.id);
        return {
          id: item.id,
          title: item.title,
          snippet: original?.snippet ?? item.content,
          body: original?.body,
          url: item.url ?? original?.url ?? '',
          rank: index + 1,
          relevance: item.rrfScore,
          fetchedAt: original?.fetchedAt ?? new Date().toISOString()
        } satisfies WebResult;
      });

    if (rerankedWebResults.length) {
      webResults.splice(0, webResults.length, ...rerankedWebResults);
      const { text, tokens, trimmed, usedResults } = buildWebContext(
        rerankedWebResults,
        config.WEB_CONTEXT_MAX_TOKENS
      );
      webContextText = text;
      webContextTokens = tokens;
      webContextTrimmed = trimmed;

      emit?.('web_context', {
        tokens,
        trimmed,
        results: usedResults.map((result) => mapToTelemetryResult(result)),
        text
      });
    } else {
      webResults.splice(0, webResults.length);
      webContextText = '';
      webContextTokens = 0;
      webContextTrimmed = false;
    }

    activity.push({
      type: 'reranking',
      description: `Applied RRF to ${originalAzureCount} Azure and ${originalWebCount} web results → ${references.length} combined.`
    });

    emit?.('reranking', {
      inputAzure: originalAzureCount,
      inputWeb: originalWebCount,
      output: references.length,
      method: config.ENABLE_SEMANTIC_BOOST ? 'rrf+semantic' : 'rrf'
    });
  }

  const salienceText = salience.map((note, idx) => `[Salience ${idx + 1}] ${note.fact}`).join('\n');
  const primaryReferences = lazyReferences.length ? lazyReferences : references;

  // F-001: Build unified citation block with proper enumeration for retrieval + web sources
  // P0 Fix: When RRF was applied, web sources are already in primaryReferences - don't enumerate them twice
  const { referenceBlock, citationMetadata } = buildUnifiedCitationBlock(
    primaryReferences,
    webRerankingApplied ? [] : webResults, // Avoid double-counting when web is already merged
    lazyReferences.length > 0
  );

  const coverageChecklist = primaryReferences
    .map((ref, idx) => {
      const title = normalizeString(ref.title);
      const docKey =
        extractMetadataString(ref.metadata, ['docKey', 'documentId', 'sourceId']) ??
        extractMetadataString(ref.metadata, ['id']);
      const label = title ?? docKey ?? `Result ${idx + 1}`;
      return label ? `- [${idx + 1}] ${label}` : undefined;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);

  const retrievalInsights = retrievalSnippets
    .map((snippet) => (typeof snippet === 'string' ? snippet.trim() : ''))
    .filter((snippet) => snippet.length > 0)
    .join('\n\n');

  const contextSections: string[] = [];
  // F-001: referenceBlock now includes both retrieval AND web sources with unified numbering
  if (referenceBlock) {
    contextSections.push(referenceBlock); // Already contains section headers
    // Extract which sections were added
    if (primaryReferences.length > 0) {
      (contextSectionLabels ??= []).push('Retrieved Knowledge');
    }
    if (webResults.length > 0) {
      (contextSectionLabels ??= []).push('Web Sources');
    }
  }
  if (coverageChecklist.length) {
    contextSections.push(`### Coverage Checklist\n${coverageChecklist.join('\n')}`);
    (contextSectionLabels ??= []).push('Coverage Checklist');
    coverageChecklistCount = coverageChecklist.length;
  }
  if (retrievalInsights) {
    contextSections.push(`### Retrieval Insights\n${retrievalInsights}`);
    (contextSectionLabels ??= []).push('Retrieval Insights');
  }
  if (salienceText) {
    contextSections.push(`### Salience Signals\n${salienceText}`);
    (contextSectionLabels ??= []).push('Salience Signals');
  }

  const contextText = contextSections.join('\n\n');

  if (references.length < config.RETRIEVAL_MIN_DOCS) {
    activity.push({
      type: 'retrieval_underflow',
      description: `Retrieved ${references.length} documents (<${config.RETRIEVAL_MIN_DOCS}). Consider fallback expansion.`
    });
  }

  const knowledgeAgentSummaryProvided = Boolean(knowledgeAgentAnswer && knowledgeAgentAnswer.trim().length > 0);
  if (!diagnostics) {
    diagnostics = {};
  }
  diagnostics.knowledgeAgentSummaryProvided = knowledgeAgentSummaryProvided;
  if (coverageChecklistCount !== undefined) {
    diagnostics.coverageChecklistCount = coverageChecklistCount;
  }
  if (contextSectionLabels && contextSectionLabels.length) {
    diagnostics.contextSectionLabels = contextSectionLabels;
  }

  emit?.('telemetry', {
    type: 'retrieval_context',
    timestamp: new Date().toISOString(),
    sections: contextSectionLabels ?? [],
    coverageChecklistCount: coverageChecklistCount ?? 0,
    latencyMs: retrievalLatencyMs ?? null,
    knowledgeAgentSummary: {
      present: knowledgeAgentSummaryProvided,
      length: knowledgeAgentAnswer ? knowledgeAgentAnswer.length : 0
    }
  });

  return {
    contextText,
    references,
    lazyReferences,
    activity,
    webResults,
    webContextText,
    webContextTokens,
    webContextTrimmed,
    summaryTokens,
    knowledgeAgentAnswer,
    contextSectionLabels,
    coverageChecklistCount,
    source,
    retrievalMode,
    strategy,
    escalated,
    adaptiveStats,
    diagnostics,
    knowledgeAgentGrounding,
    retrievalThresholdUsed,
    retrievalThresholdHistory,
    retrievalLatencyMs,
    citationMetadata // F-001: Include citation enumeration metadata
  };
}
