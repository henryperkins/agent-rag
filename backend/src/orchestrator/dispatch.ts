import type {
  AgentMessage,
  PlanSummary,
  Reference,
  ActivityStep,
  WebResult,
  WebSearchResponse,
  LazyReference,
  FeatureOverrideMap
} from '../../../shared/types.js';
import { retrieveTool, webSearchTool, lazyRetrieveTool } from '../tools/index.js';
import type { SalienceNote } from './compact.js';
import { config } from '../config/app.js';
import { estimateTokens } from './contextBudget.js';
import { reciprocalRankFusion, applySemanticBoost } from './reranker.js';
import { generateEmbedding } from '../azure/directSearch.js';
import { filterWebResults } from '../tools/webQualityFilter.js';
import type { FeatureGates } from '../config/features.js';
import type { AdaptiveRetrievalStats } from '../../../shared/types.js';

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
  source: 'direct' | 'fallback_vector';
  retrievalMode: 'direct' | 'lazy';
  escalated: boolean;
  adaptiveStats?: AdaptiveRetrievalStats;
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
      mode?: 'direct' | 'lazy';
      fullContentAvailable?: boolean;
    }>;
    lazyRetrieve?: (args: { query: string; filter?: string; top?: number }) => Promise<{
      response: string;
      references: Reference[];
      activity: ActivityStep[];
      lazyReferences?: LazyReference[];
      summaryTokens?: number;
      mode?: 'direct' | 'lazy';
      fullContentAvailable?: boolean;
    }>;
    webSearch?: (args: { query: string; count?: number; mode?: 'summary' | 'full' }) => Promise<WebSearchResponse>;
  };
  preferLazy?: boolean;
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
  let source: 'direct' | 'fallback_vector' = 'direct';
  let retrievalMode: 'direct' | 'lazy' = 'direct';
  let summaryTokens: number | undefined;
  const confidence = typeof plan.confidence === 'number' ? plan.confidence : 1;
  const threshold = config.PLANNER_CONFIDENCE_DUAL_RETRIEVAL;
  const escalated = confidence < threshold;

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
    const useLazy = wantsLazy && supportsLazy;
    const retrieval = useLazy
      ? await lazyRetrieve({ query, top: retrievalStep?.k })
      : await retrieve({ query, messages, features: featureStates });

    references.push(...(retrieval.references ?? []));
    if ('lazyReferences' in retrieval && Array.isArray(retrieval.lazyReferences) && retrieval.lazyReferences.length) {
      lazyReferences.push(...retrieval.lazyReferences);
      summaryTokens = retrieval.summaryTokens;
      retrievalMode = retrieval.mode === 'lazy' ? 'lazy' : 'direct';
    }

    activity.push(
      ...(retrieval.activity ?? []),
      {
        type: 'plan',
        description: `${useLazy ? 'Lazy' : 'Direct'} Azure AI Search retrieval executed via orchestrator.`
      }
    );
    if (typeof retrieval.response === 'string' && retrieval.response.trim().length) {
      retrievalSnippets.push(retrieval.response.trim());
    }
    if (retrieval.activity?.some((step) => step.type === 'fallback_search')) {
      source = 'fallback_vector';
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
  }

  const wantsWeb = escalated || plan.steps.some((step) => step.action === 'web_search' || step.action === 'both');
  let webContextText = '';
  let webContextTokens = 0;
  let webContextTrimmed = false;
  if (wantsWeb) {
    emit?.('status', { stage: 'web_search' });
    const step = plan.steps.find((s) => s.action === 'web_search' || s.action === 'both');
    const query = step?.query?.trim() || queryFallback;
    const count = step?.k ?? config.WEB_RESULTS_MAX;
    try {
      const search = await webSearch({ query, count, mode: config.WEB_SEARCH_MODE });
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

  if (features.webReranking && references.length > 0 && webResults.length > 0) {
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
        const queryEmbedding = await generateEmbedding(queryFallback);
        const documentEmbeddings = new Map<string, number[]>();
        const boostCandidates = reranked.slice(0, config.RERANKING_TOP_K);

        for (const candidate of boostCandidates) {
          const content = candidate.content?.slice(0, 1000);
          if (content) {
            const embedding = await generateEmbedding(content);
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
        results: usedResults.map((result) => ({
          id: result.id,
          title: result.title,
          url: result.url,
          rank: result.rank
        })),
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
  const referenceText = primaryReferences
    .map((ref, idx) => `[${idx + 1}] ${ref.content ?? ''}`)
    .join('\n\n');

  const referenceBlock = lazyReferences.length ? '' : referenceText;
  const contextText = [referenceBlock, retrievalSnippets.join('\n\n'), salienceText]
    .filter((block) => Boolean(block && block.trim()))
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
    lazyReferences,
    activity,
    webResults,
    webContextText,
    webContextTokens,
    webContextTrimmed,
    summaryTokens,
    source,
    retrievalMode,
    escalated,
    adaptiveStats
  };
}
