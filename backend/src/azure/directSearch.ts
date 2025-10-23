/**
 * Direct Azure AI Search Integration
 *
 * Provides full control over search queries with support for:
 * - Hybrid search (vector + keyword with RRF)
 * - Semantic ranking (L2 reranker)
 * - Filters, facets, and custom scoring
 * - Field selection and highlighting
 * - Authentication via API key or Managed Identity
 */

import type { Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { performSearchRequest } from './searchHttp.js';
import { enforceRerankerThreshold } from '../utils/reranker-threshold.js';
import { embedText } from '../utils/embeddings.js';

// ============================================================================
// Types
// ============================================================================

export interface SearchOptions {
  // Query
  query: string;
  queryVector?: number[];

  // Search modes
  searchMode?: 'any' | 'all'; // For keyword search
  queryType?: 'simple' | 'semantic' | 'vector' | 'hybrid';

  // Results
  top?: number;
  skip?: number;

  // Semantic ranking
  semanticConfiguration?: string;

  // Filtering & faceting
  filter?: string;
  facets?: string[];
  orderBy?: string[];

  // Vector search config
  vectorFields?: string[];
  vectorFilterMode?: 'preFilter' | 'postFilter';

  // Field control
  select?: string[];
  searchFields?: string[];
  highlightFields?: string[];

  // Scoring
  scoringProfile?: string;
  minimumCoverage?: number;

  // Reranking
  rerankerThreshold?: number;
}

export interface SearchResult {
  // Standard fields
  '@search.score': number;
  '@search.rerankerScore'?: number;
  '@search.highlights'?: Record<string, string[]>;
  '@search.captions'?: Array<{
    text: string;
    highlights: string;
  }>;

  // Document fields (dynamic)
  [key: string]: any;
}

export interface SearchResponse {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@search.facets'?: Record<string, any[]>;
  '@search.coverage'?: number;
  '@search.nextPageParameters'?: any;

  value: SearchResult[];
}

export interface DirectSearchResponse {
  references: Reference[];
  totalResults?: number;
  facets?: Record<string, any[]>;
  coverage?: number;
}

// ============================================================================
// Query Builder
// ============================================================================

export class SearchQueryBuilder {
  private options: SearchOptions;

  constructor(query: string) {
    this.options = { query };
  }

  // Vector search
  withVector(vector: number[], fields: string[] = ['contentVector']): this {
    this.options.queryVector = vector;
    this.options.vectorFields = fields;
    return this;
  }

  // Hybrid search (vector + keyword with RRF)
  asHybrid(vector: number[], vectorFields?: string[]): this {
    this.options.queryType = 'simple'; // Will be upgraded to semantic if withSemanticRanking() is called
    this.options.queryVector = vector;
    this.options.vectorFields = vectorFields || ['contentVector'];
    return this;
  }

  // Semantic ranking
  withSemanticRanking(configName: string = 'default'): this {
    this.options.queryType = 'semantic';
    this.options.semanticConfiguration = configName;
    return this;
  }

  // Filters (OData syntax)
  withFilter(filter: string): this {
    this.options.filter = filter;
    return this;
  }

  // Facets
  withFacets(facets: string[]): this {
    this.options.facets = facets;
    return this;
  }

  // Pagination
  take(count: number): this {
    this.options.top = count;
    return this;
  }

  skip(count: number): this {
    this.options.skip = count;
    return this;
  }

  // Field selection
  selectFields(fields: string[]): this {
    this.options.select = fields;
    return this;
  }

  searchInFields(fields: string[]): this {
    this.options.searchFields = fields;
    return this;
  }

  // Highlighting
  highlightFields(fields: string[]): this {
    this.options.highlightFields = fields;
    return this;
  }

  // Scoring
  withScoringProfile(profile: string): this {
    this.options.scoringProfile = profile;
    return this;
  }

  // Minimum reranker score
  withRerankerThreshold(threshold: number): this {
    this.options.rerankerThreshold = threshold;
    return this;
  }

  // Build final query payload
  withVectorFilterMode(mode: 'preFilter' | 'postFilter'): this {
    this.options.vectorFilterMode = mode;
    return this;
  }

  // Build final query payload
  build(): any {
    const payload: any = {
      search: this.options.query,
      top: this.options.top,
      skip: this.options.skip,
      searchMode: this.options.searchMode,
      queryType: this.options.queryType,
      filter: this.options.filter,
      facets: this.options.facets,
      orderby: this.options.orderBy?.join(','),
      select: this.options.select?.join(','),
      searchFields: this.options.searchFields?.join(','),
      highlight: this.options.highlightFields?.join(','),
      scoringProfile: this.options.scoringProfile,
      minimumCoverage: this.options.minimumCoverage
    };

    // Semantic config
    if (this.options.semanticConfiguration) {
      payload.semanticConfiguration = this.options.semanticConfiguration;
    }

    // Vector search
    if (this.options.queryVector && this.options.vectorFields) {
      payload.vectorQueries = [{
        kind: 'vector',
        vector: this.options.queryVector,
        fields: this.options.vectorFields.join(','),
        k: this.options.top || 50,
        exhaustive: false
      }];

      // filterMode is only available in preview API versions (2024-11-01-preview+)
      // Skip when using GA contracts; stack pins to 2025-08-01-preview to avoid 400 errors
      // if (this.options.vectorFilterMode) {
      //   payload.vectorQueries[0].filterMode = this.options.vectorFilterMode;
      // }
    }

    // Remove undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    return payload;
  }

  getOptions(): SearchOptions {
    return { ...this.options };
  }
}

// Heuristic: treat simple equality filters without OR as restrictive
export function isRestrictiveFilter(filter: string): boolean {
  if (!filter) return false;
  const f = filter.toLowerCase();
  const hasEq = f.includes(' eq ');
  const hasOr = f.includes(' or ');
  return hasEq && !hasOr;
}

// ============================================================================
// Direct Search API
// ============================================================================

export async function executeSearch(
  indexName: string,
  queryBuilder: SearchQueryBuilder,
  options: { signal?: AbortSignal; correlationId?: string; retryAttempt?: number } = {}
): Promise<SearchResponse> {
  const encodedIndexName = encodeURIComponent(indexName);
  const url = `${config.AZURE_SEARCH_ENDPOINT}/indexes('${encodedIndexName}')/docs/search?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const payload = queryBuilder.build();

  const { response } = await performSearchRequest('docs.search', url, {
    method: 'POST',
    body: payload,
    contentType: 'application/json',
    correlationId: options.correlationId,
    signal: options.signal,
    retryAttempt: options.retryAttempt
  });

  return (await response.json()) as SearchResponse;
}

// ============================================================================
// High-Level Search Functions
// ============================================================================

type SearchMode = 'hybrid' | 'vector' | 'keyword';

interface BaseDirectSearchOptions {
  indexName?: string;
  top?: number;
  filter?: string;
  signal?: AbortSignal;
  correlationId?: string;
}

interface HybridSearchOptions extends BaseDirectSearchOptions {
  mode: 'hybrid';
  semanticConfig?: string;
  rerankerThreshold?: number;
  searchFields?: string[];
  selectFields?: string[];
  sessionId?: string;
  vectorFields?: string[];
}

interface VectorSearchOptions extends BaseDirectSearchOptions {
  mode: 'vector';
  vectorFields?: string[];
}

interface KeywordSearchOptions extends BaseDirectSearchOptions {
  mode: 'keyword';
  searchFields?: string[];
  semanticRanking?: boolean;
}

type UnifiedSearchOptions = HybridSearchOptions | VectorSearchOptions | KeywordSearchOptions;

const DEFAULT_VECTOR_FIELDS = ['page_embedding_text_3_large'];
const DEFAULT_SELECT_FIELDS = ['id', 'page_chunk', 'page_number'];
const DEFAULT_SEARCH_FIELDS = ['page_chunk'];

function mapSearchResults(results: SearchResult[], mode: SearchMode): Reference[] {
  return results.map((result, idx) => ({
    id: result.id || result.chunk_id || `result_${idx}`,
    title: result.title || `Page ${result.page_number || idx + 1}`,
    content: result.content || result.page_chunk || result.chunk || '',
    chunk: result.chunk || result.page_chunk,
    page_number: result.page_number,
    url: mode === 'hybrid' ? undefined : result.url,
    score: result['@search.rerankerScore'] ?? result['@search.score'],
    metadata: result.metadata,
    highlights: result['@search.highlights'],
    captions: result['@search.captions']
  }));
}

async function runDirectSearch(query: string, options: UnifiedSearchOptions): Promise<DirectSearchResponse> {
  const indexName = options.indexName ?? config.AZURE_SEARCH_INDEX_NAME;
  const top = options.top ?? config.RAG_TOP_K;

  let queryVector: number[] | undefined;
  const ensureQueryVector = async () => {
    if (!queryVector) {
      queryVector = await embedText(query, { signal: options.signal });
    }
    return queryVector;
  };

  let builder: SearchQueryBuilder;

  switch (options.mode) {
    case 'vector': {
      const vector = await ensureQueryVector();
      builder = new SearchQueryBuilder('*')
        .withVector(vector, options.vectorFields ?? DEFAULT_VECTOR_FIELDS)
        .take(top)
        .selectFields(DEFAULT_SELECT_FIELDS);

      if (options.filter) {
        builder.withFilter(options.filter);
      }
      break;
    }
    case 'keyword': {
      builder = new SearchQueryBuilder(query)
        .take(top)
        .selectFields(DEFAULT_SELECT_FIELDS)
        .searchInFields(options.searchFields ?? DEFAULT_SEARCH_FIELDS)
        .highlightFields(['page_chunk']);

      if (options.semanticRanking) {
        builder.withSemanticRanking('default');
      }
      if (options.filter) {
        builder.withFilter(options.filter);
      }
      break;
    }
    case 'hybrid': {
      const vector = await ensureQueryVector();
      builder = new SearchQueryBuilder(query)
        .asHybrid(vector, options.vectorFields ?? DEFAULT_VECTOR_FIELDS)
        .withSemanticRanking(options.semanticConfig ?? 'default')
        .take(top * 2)
        .selectFields(options.selectFields ?? DEFAULT_SELECT_FIELDS)
        .searchInFields(options.searchFields ?? DEFAULT_SEARCH_FIELDS)
        .highlightFields(['page_chunk']);

      if (options.filter) {
        builder.withFilter(options.filter);
        if (isRestrictiveFilter(options.filter)) {
          builder.withVectorFilterMode('preFilter');
        }
      }

      if (options.rerankerThreshold !== undefined) {
        builder.withRerankerThreshold(options.rerankerThreshold);
      }
      break;
    }
    default: {
      const mode = (options as { mode: string }).mode;
      throw new Error(`Unsupported search mode: ${mode}`);
    }
  }

  const response = await executeSearch(indexName, builder, {
    signal: options.signal,
    correlationId: options.correlationId
  });

  let references = mapSearchResults(response.value, options.mode);

  if (options.mode === 'hybrid') {
    const enforcement = enforceRerankerThreshold(references, options.rerankerThreshold, {
      sessionId: options.sessionId,
      correlationId: options.correlationId,
      source: 'hybrid_semantic'
    });
    references = enforcement.references.slice(0, top);
  } else {
    references = references.slice(0, top);
  }

  return {
    references,
    totalResults: response['@odata.count'],
    facets: response['@search.facets'],
    coverage: response['@search.coverage']
  };
}

/**
 * Hybrid Search with Semantic Ranking (Recommended)
 * Combines vector similarity + keyword matching + L2 semantic reranking
 */
export async function hybridSemanticSearch(
  query: string,
  options: Omit<HybridSearchOptions, 'mode'> = {}
): Promise<DirectSearchResponse> {
  return runDirectSearch(query, { mode: 'hybrid', ...options });
}

/**
 * Pure Vector Search
 * Best for semantic similarity without keyword matching
 */
export async function vectorSearch(
  query: string,
  options: Omit<VectorSearchOptions, 'mode'> = {}
): Promise<DirectSearchResponse> {
  return runDirectSearch(query, { mode: 'vector', ...options });
}

/**
 * Keyword Search with Optional Semantic Ranking
 * Best for exact term matching
 */
export async function keywordSearch(
  query: string,
  options: Omit<KeywordSearchOptions, 'mode'> = {}
): Promise<DirectSearchResponse> {
  return runDirectSearch(query, { mode: 'keyword', ...options });
}
