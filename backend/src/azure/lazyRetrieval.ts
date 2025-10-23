import type { LazyReference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { hybridSemanticSearch } from './directSearch.js';
import { withRetry } from '../utils/resilience.js';
import { estimateTokens } from '../orchestrator/contextBudget.js';
import { enforceRerankerThreshold } from '../utils/reranker-threshold.js';

export interface LazySearchOptions {
  query: string;
  top?: number;
  filter?: string;
  rerankerThreshold?: number;
  prefetchCount?: number;
}

export interface LazySearchResult {
  references: LazyReference[];
  summaryTokens: number;
  fullContentAvailable: boolean;
}

function truncateSummary(content: string | undefined): string {
  if (!content) {
    return '';
  }
  if (content.length <= config.LAZY_SUMMARY_MAX_CHARS) {
    return content;
  }
  return `${content.slice(0, config.LAZY_SUMMARY_MAX_CHARS)}…`;
}

function buildFullContentFilter(id: string): string {
  const escaped = id.replace(/'/g, "''");
  return `id eq '${escaped}'`;
}

function createFullLoader(id: string | undefined, query: string, baseFilter?: string) {
  let cached: string | null = null;

  return async () => {
    if (!id) {
      return '';
    }
    if (cached !== null) {
      return cached;
    }

    try {
      const result = await withRetry('lazy-load-full', async (_signal) =>
        hybridSemanticSearch(query, {
          top: 1,
          filter: baseFilter ? `(${baseFilter}) and ${buildFullContentFilter(id)}` : buildFullContentFilter(id),
          selectFields: ['id', 'page_chunk', 'page_number'],
          searchFields: ['page_chunk']
        })
      );
      cached = result.references[0]?.content ?? '';
      return cached;
    } catch (error) {
      const errorDetails = {
        operation: 'lazy-load-full',
        documentId: id,
        query: query.substring(0, 100),
        filter: baseFilter,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      };
      console.error('[LAZY_LOAD_FULL_ERROR] Failed to load full document content:', JSON.stringify(errorDetails, null, 2));
      cached = '';
      return cached;
    }
  };
}

export async function lazyHybridSearch(options: LazySearchOptions): Promise<LazySearchResult> {
  const {
    query,
    top = config.RAG_TOP_K,
    filter,
    rerankerThreshold = config.RERANKER_THRESHOLD,
    prefetchCount = config.LAZY_PREFETCH_COUNT
  } = options;

  const searchTop = Math.max(prefetchCount, top);

  let result;
  try {
    result = await withRetry('lazy-search', async (_signal) =>
      hybridSemanticSearch(query, {
        top: searchTop,
        filter,
        rerankerThreshold,
        selectFields: ['id', 'page_chunk', 'page_number'],
        searchFields: ['page_chunk']
      })
    );
  } catch (error) {
    const errorDetails = {
      operation: 'lazy-search',
      query: query.substring(0, 100),
      top: searchTop,
      filter,
      rerankerThreshold,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    };
    console.error('[LAZY_RETRIEVAL_ERROR] Lazy hybrid search failed:', JSON.stringify(errorDetails, null, 2));
    throw error;
  }

  const enforcement = enforceRerankerThreshold(result.references, rerankerThreshold, {
    source: 'lazy_hybrid'
  });
  const sliced = enforcement.references.slice(0, top);
  const summaries = sliced.map((ref, index): LazyReference => {
    const summary = truncateSummary(ref.content ?? ref.chunk ?? '');
    return {
      id: ref.id ?? `result_${index}`,
      title: ref.title ?? `Result ${index + 1}`,
      summary,
      content: summary,
      url: ref.url,
      page_number: ref.page_number,
      score: ref.score,
      isSummary: true,
      loadFull: createFullLoader(ref.id ?? `result_${index}`, query, filter)
    };
  });

  const summaryText = summaries.map((ref, idx) => `[${idx + 1}] ${ref.summary ?? ''}`).join('\n\n');
  const summaryTokens = summaryText ? estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, summaryText) : 0;

  return {
    references: summaries,
    summaryTokens,
    fullContentAvailable: summaries.length > 0
  };
}

export async function loadFullContent(lazyRefs: LazyReference[], indices: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();

  await Promise.all(
    indices.map(async (position) => {
      if (position < 0 || position >= lazyRefs.length) {
        return;
      }
      const ref = lazyRefs[position];
      if (!ref) {
        return;
      }

      if (ref.isSummary === false && typeof ref.content === 'string') {
        map.set(position, ref.content);
        return;
      }

      try {
        const loader = ref.loadFull;
        const content = loader ? await loader() : ref.content ?? '';
        if (content) {
          map.set(position, content);
        }
      } catch (error) {
        console.warn(`Lazy load failed for index ${position}:`, error);
      }
    })
  );

  return map;
}

export function identifyLoadCandidates(lazyRefs: LazyReference[], criticIssues: string[] = []): number[] {
  if (!lazyRefs.length) {
    return [];
  }
  const needsDetail = criticIssues.some((issue) =>
    /insufficient|lack|need more|missing|detail|expand/i.test(issue)
  );

  if (!needsDetail) {
    return [];
  }

  return [0, 1, 2].filter((index) => index < lazyRefs.length);
}
