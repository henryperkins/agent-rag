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

import { DefaultAzureCredential } from '@azure/identity';
import type { Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { getSearchAuthHeaders } from './searchAuth.js';
import { enforceRerankerThreshold } from '../utils/reranker-threshold.js';

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
// Authentication
// ============================================================================

const credential = new DefaultAzureCredential();
const openAIEmbeddingScope = 'https://cognitiveservices.azure.com/.default';

let cachedOpenAIToken:
  | {
      token: string;
      expiresOnTimestamp: number;
    }
  | null = null;

// ============================================================================
// Embeddings Service
// ============================================================================

export async function generateEmbedding(text: string): Promise<number[]> {
  const endpoint = config.AZURE_OPENAI_EMBEDDING_ENDPOINT || config.AZURE_OPENAI_ENDPOINT;
  const apiKey = config.AZURE_OPENAI_EMBEDDING_API_KEY || config.AZURE_OPENAI_API_KEY;

  if (!endpoint) {
    throw new Error('Azure OpenAI embedding endpoint required for vector search');
  }

  const url = `${endpoint}/openai/deployments/${config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT}/embeddings?api-version=2024-02-01`;

  // Build auth headers
  let authHeaders: Record<string, string>;
  if (apiKey) {
    authHeaders = { 'api-key': apiKey };
  } else {
    const now = Date.now();
    if (cachedOpenAIToken && cachedOpenAIToken.expiresOnTimestamp - now > 120000) {
      authHeaders = { Authorization: `Bearer ${cachedOpenAIToken.token}` };
    } else {
      const tokenResponse = await credential.getToken(openAIEmbeddingScope);
      if (!tokenResponse?.token) {
        throw new Error('Failed to obtain Azure OpenAI token for managed identity authentication');
      }

      cachedOpenAIToken = {
        token: tokenResponse.token,
        expiresOnTimestamp: tokenResponse.expiresOnTimestamp ?? now + 15 * 60 * 1000
      };

      authHeaders = { Authorization: `Bearer ${tokenResponse.token}` };
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      input: text,
      model: config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding generation failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
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
  queryBuilder: SearchQueryBuilder
): Promise<SearchResponse> {
  const encodedIndexName = encodeURIComponent(indexName);
  const url = `${config.AZURE_SEARCH_ENDPOINT}/indexes('${encodedIndexName}')/docs/search?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const authHeaders = await getSearchAuthHeaders();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders
  };

  const payload = queryBuilder.build();

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure AI Search query failed: ${response.status} ${error}`);
  }

  return (await response.json()) as SearchResponse;
}

// ============================================================================
// High-Level Search Functions
// ============================================================================

/**
 * Hybrid Search with Semantic Ranking (Recommended)
 * Combines vector similarity + keyword matching + L2 semantic reranking
 */
export async function hybridSemanticSearch(
  query: string,
  options: {
    indexName?: string;
    top?: number;
    filter?: string;
    semanticConfig?: string;
    rerankerThreshold?: number;
    searchFields?: string[];
    selectFields?: string[];
    sessionId?: string;
    correlationId?: string;
  } = {}
): Promise<DirectSearchResponse> {
  const indexName = options.indexName || config.AZURE_SEARCH_INDEX_NAME;

  // Generate query vector
  const queryVector = await generateEmbedding(query);

  // Build hybrid semantic query
  const builder = new SearchQueryBuilder(query)
    .asHybrid(queryVector, ['page_embedding_text_3_large'])
    .withSemanticRanking(options.semanticConfig || 'default')
    .take(options.top || config.RAG_TOP_K * 2) // Get more for reranking
    .selectFields(options.selectFields || ['id', 'page_chunk', 'page_number'])
    .searchInFields(options.searchFields || ['page_chunk'])
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

  const response = await executeSearch(indexName, builder);

  const top = options.top || config.RAG_TOP_K;
  const rawResults = response.value;

  const mappedReferences: Reference[] = rawResults.map((result, idx) => ({
    id: result.id || result.chunk_id || `result_${idx}`,
    title: `Page ${result.page_number || idx + 1}`,
    content: result.content || result.page_chunk || result.chunk || '',
    chunk: result.chunk || result.page_chunk,
    page_number: result.page_number,
    url: undefined,
    score: result['@search.rerankerScore'] || result['@search.score'],
    metadata: result.metadata,
    highlights: result['@search.highlights'],
    captions: result['@search.captions']
  }));
  const enforcement = enforceRerankerThreshold(mappedReferences, options.rerankerThreshold, {
    sessionId: options.sessionId,
    correlationId: options.correlationId,
    source: 'hybrid_semantic'
  });
  const references = enforcement.references.slice(0, top);

  return {
    references,
    totalResults: response['@odata.count'],
    facets: response['@search.facets'],
    coverage: response['@search.coverage']
  };
}

/**
 * Pure Vector Search
 * Best for semantic similarity without keyword matching
 */
export async function vectorSearch(
  query: string,
  options: {
    indexName?: string;
    top?: number;
    filter?: string;
    vectorFields?: string[];
  } = {}
): Promise<DirectSearchResponse> {
  const indexName = options.indexName || config.AZURE_SEARCH_INDEX_NAME;
  const queryVector = await generateEmbedding(query);

  const builder = new SearchQueryBuilder('*')
    .withVector(queryVector, options.vectorFields || ['page_embedding_text_3_large'])
    .take(options.top || config.RAG_TOP_K)
    .selectFields(['id', 'page_chunk', 'page_number']);

  if (options.filter) {
    builder.withFilter(options.filter);
  }

  const response = await executeSearch(indexName, builder);

  const references: Reference[] = response.value.map((result, idx) => ({
    id: result.id || `result_${idx}`,
    title: result.title || `Page ${result.page_number || idx + 1}`,
    content: result.content || result.page_chunk || result.chunk || '',
    chunk: result.chunk || result.page_chunk,
    page_number: result.page_number,
    url: result.url,
    score: result['@search.score'],
    metadata: result.metadata
  }));

  return { references, totalResults: response['@odata.count'] };
}

/**
 * Keyword Search with Optional Semantic Ranking
 * Best for exact term matching
 */
export async function keywordSearch(
  query: string,
  options: {
    indexName?: string;
    top?: number;
    filter?: string;
    searchFields?: string[];
    semanticRanking?: boolean;
  } = {}
): Promise<DirectSearchResponse> {
  const indexName = options.indexName || config.AZURE_SEARCH_INDEX_NAME;

  const builder = new SearchQueryBuilder(query)
    .take(options.top || config.RAG_TOP_K)
    .selectFields(['id', 'page_chunk', 'page_number'])
    .searchInFields(options.searchFields || ['page_chunk'])
    .highlightFields(['page_chunk']);

  if (options.semanticRanking) {
    builder.withSemanticRanking('default');
  }

  if (options.filter) {
    builder.withFilter(options.filter);
  }

  const response = await executeSearch(indexName, builder);

  const references: Reference[] = response.value.map((result, idx) => ({
    id: result.id || `result_${idx}`,
    title: result.title || `Page ${result.page_number || idx + 1}`,
    content: result.content || result.page_chunk || result.chunk || '',
    chunk: result.chunk || result.page_chunk,
    page_number: result.page_number,
    url: result.url,
    score: result['@search.rerankerScore'] || result['@search.score'],
    metadata: result.metadata,
    highlights: result['@search.highlights']
  }));

  return { references, totalResults: response['@odata.count'] };
}
